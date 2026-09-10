import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { AppDataSource } from "../data-source";
import { SkillDefinition, SkillStatus, SkillVisibility } from "../entities/SkillDefinition";
import { isCosEnabled, pathToKey, upload as cosUpload, getFileContent } from "./cos.service";
import { adaptSkillWithLlm } from "../skills/skill-adapt.service";
import { assessSkillCompat, type CompatReport } from "../skills/skill-compat";
import { detectExecutableScripts, detectHasScripts, parseSkillMarkdown, resolveSkillDisplayName } from "../skills/parse-skill-md";
import {
    SKILL_BODY_INJECT_MAX_CHARS,
    SKILL_PRIVATE_QUOTA_DEFAULT,
    SKILL_ZIP_MAX_BYTES,
} from "../skills/workflow-agent.tools";

export type SkillImportMode = "private" | "admin_global";

export type SkillListItem = {
    id: number;
    name: string;
    /** 中文/可读展示名（下拉与列表优先显示） */
    display_name: string;
    description: string;
    visibility: SkillVisibility;
    status: SkillStatus;
    owner_user_id: number;
    compat_flags: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
    group: "global" | "mine" | "draft" | "other";
    /** true：节点执行应拉起 Agent；false：提示词增强后直接生成 */
    requires_agent: boolean;
    compat_grade?: string | null;
    compat_report?: CompatReport | null;
    has_adapted?: boolean;
};

/** 判断 Skill 是否需要控制模型编排（而非仅拼 prompt） */
export function skillRequiresAgent(row: {
    name?: string | null;
    body_md?: string | null;
    frontmatter_json?: Record<string, unknown> | null;
    assets_json?: string[] | null;
    compat_flags?: Record<string, unknown> | null;
}): boolean {
    const fm = row.frontmatter_json || {};
    const flags = row.compat_flags || {};
    if (fm.requires_agent === false || fm.requires_agent === "false") return false;
    if (String(fm.execution || "").toLowerCase() === "prompt") return false;
    if (flags.requires_agent === false) return false;

    if (fm.requires_agent === true || fm.requires_agent === "true") return true;
    if (String(fm.execution || "").toLowerCase() === "agent") return true;
    if (String(fm.mode || "").toLowerCase() === "agent") return true;
    if (flags.requires_agent === true) return true;
    if (Number(flags.asset_count) > 0) return true;

    const assets = Array.isArray(row.assets_json) ? row.assets_json : [];
    if (assets.length > 0) return true;

    // 市场包常见标记（含多阶段 + references）
    if (fm["exported-by"] || fm.exported_by || fm["exported_by"]) return true;

    const entryPaths = Array.isArray(flags.entry_paths) ? (flags.entry_paths as unknown[]).map(String) : [];
    if (entryPaths.some((p) => /(^|\/)(references|assets)\//i.test(p))) return true;

    const name = String(row.name || fm.name || "").toLowerCase();
    if (name === "art-qc-review" || name.includes("qc-review")) return true;

    const body = String(row.body_md || "");
    if (/create_review_pipeline|create_image_pipeline|create_video_pipeline/.test(body)) return true;

    return false;
}

function isRegistryEnabled(): boolean {
    return process.env.SKILL_REGISTRY_ENABLED !== "false";
}

function privateQuota(): number {
    const n = Number(process.env.SKILL_PRIVATE_QUOTA || SKILL_PRIVATE_QUOTA_DEFAULT);
    return Number.isFinite(n) && n > 0 ? n : SKILL_PRIVATE_QUOTA_DEFAULT;
}

function uploadsRoot(): string {
    return path.join(process.cwd(), "uploads");
}

async function saveBuffer(logicalPath: string, buffer: Buffer, contentType: string): Promise<void> {
    if (isCosEnabled()) {
        await cosUpload(pathToKey(logicalPath), buffer, contentType);
        return;
    }
    const abs = path.join(process.cwd(), logicalPath.replace(/^\//, ""));
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, buffer);
}

async function readPackageBuffer(logicalPath: string): Promise<Buffer> {
    if (logicalPath.includes("/uploads/")) {
        try {
            return await getFileContent(logicalPath.startsWith("/") ? logicalPath : `/${logicalPath}`);
        } catch {
            /* fall through */
        }
    }
    const abs = path.join(process.cwd(), logicalPath.replace(/^\//, ""));
    return fs.promises.readFile(abs);
}

function extractSkillFromBuffer(fileName: string, buffer: Buffer): {
    md: string;
    paths: string[];
    packageBuffer: Buffer;
    packageExt: string;
} {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".md")) {
        return {
            md: buffer.toString("utf8"),
            paths: ["SKILL.md"],
            packageBuffer: buffer,
            packageExt: ".md",
        };
    }
    if (!lower.endsWith(".zip")) {
        throw new Error("仅支持 .zip 或 .md（SKILL.md）");
    }
    if (buffer.length > SKILL_ZIP_MAX_BYTES) {
        throw new Error(`压缩包过大（上限 ${Math.floor(SKILL_ZIP_MAX_BYTES / 1024 / 1024)}MB）`);
    }
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const paths = entries.map((e) => e.entryName.replace(/\\/g, "/"));
    const skillEntry =
        entries.find((e) => /(^|\/)SKILL\.md$/i.test(e.entryName.replace(/\\/g, "/"))) ||
        entries.find((e) => /SKILL\.md$/i.test(e.entryName));
    if (!skillEntry) {
        throw new Error("压缩包内未找到 SKILL.md");
    }
    const md = skillEntry.getData().toString("utf8");
    return { md, paths, packageBuffer: buffer, packageExt: ".zip" };
}

function toListItem(row: SkillDefinition, viewerId: number): SkillListItem {
    let group: SkillListItem["group"] = "other";
    if (row.visibility === "global") group = "global";
    else if (
        Number(row.owner_user_id) === Number(viewerId) &&
        (row.visibility === "private" || row.visibility === "draft" || row.visibility === "disabled")
    ) {
        group = "mine";
    } else if (row.visibility === "draft") group = "draft";
    const entryPaths = Array.isArray(row.compat_flags?.entry_paths)
        ? (row.compat_flags!.entry_paths as unknown[]).map(String)
        : [];
    const report =
        (row.compat_report_json as CompatReport) ||
        assessSkillCompat({
            name: row.name,
            description: row.description,
            body_md: row.body_md,
            frontmatter: row.frontmatter_json ?? null,
            entry_paths: entryPaths,
            asset_paths: Array.isArray(row.assets_json) ? row.assets_json.map(String) : [],
        });
    return {
        id: row.id,
        name: row.name,
        display_name: resolveSkillDisplayName(row),
        description: row.description,
        visibility: row.visibility,
        status: row.status,
        owner_user_id: Number(row.owner_user_id),
        compat_flags: (row.compat_flags as Record<string, unknown>) || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        group,
        requires_agent: skillRequiresAgent(row),
        compat_grade: row.compat_grade || report.grade,
        compat_report: report,
        has_adapted: Boolean(row.adapted_body_md && String(row.adapted_body_md).trim()),
    };
}

export class SkillService {
    private repo() {
        return AppDataSource.getRepository(SkillDefinition);
    }

    assertEnabled() {
        if (!isRegistryEnabled()) {
            throw new Error("Skill 注册表未启用（SKILL_REGISTRY_ENABLED=false）");
        }
    }

    async importSkill(params: {
        userId: number;
        mode: SkillImportMode;
        fileName: string;
        buffer: Buffer;
    }): Promise<SkillDefinition> {
        this.assertEnabled();
        const { userId, mode, fileName, buffer } = params;
        const extracted = extractSkillFromBuffer(fileName, buffer);
        const parsed = parseSkillMarkdown(extracted.md);
        const hasScripts = detectHasScripts(extracted.paths);
        const hasExecutableScripts = detectExecutableScripts(extracted.paths);
        // 市场包 scripts/*.js 多为 Hub GUI，本产品不执行任何脚本；仅可执行脚本标 unsupported
        const status: SkillStatus = hasExecutableScripts ? "unsupported" : "active";
        const visibility: SkillVisibility = "private";

        // 私有配额：用户上传与超管后台上传（默认仅自己可用）都计入
        {
            const count = await this.repo().count({
                where: { owner_user_id: userId, visibility: "private" },
            });
            if (count >= privateQuota()) {
                throw new Error(`私有 Skill 已达上限（${privateQuota()}）`);
            }
        }

        const row = this.repo().create({
            owner_user_id: userId,
            name: parsed.name,
            description: parsed.description,
            body_md: parsed.body,
            frontmatter_json: parsed.frontmatter,
            visibility,
            status,
            compat_flags: {
                has_scripts: hasScripts,
                entry_paths: extracted.paths.slice(0, 50),
            },
        });
        const saved = await this.repo().save(row);

        const scopeDir = `u/${userId}`;
        const logical = `/uploads/skills/${scopeDir}/${saved.id}/package${extracted.packageExt}`;
        const ctype = extracted.packageExt === ".zip" ? "application/zip" : "text/markdown; charset=utf-8";
        await saveBuffer(logical, extracted.packageBuffer, ctype);
        saved.package_key = logical;

        // 抽取 references/assets 文本附件，供 Agent 按需 load_skill_asset
        const assetPaths = await this.materializeTextAssets(saved, extracted.packageBuffer, extracted.packageExt);
        saved.assets_json = assetPaths;
        saved.compat_flags = {
            ...(saved.compat_flags || {}),
            has_scripts: hasScripts,
            has_executable_scripts: hasExecutableScripts,
            has_hub_gui: hasScripts && !hasExecutableScripts,
            entry_paths: extracted.paths.slice(0, 50),
            asset_count: assetPaths.length,
            requires_agent: skillRequiresAgent({
                ...saved,
                assets_json: assetPaths,
                frontmatter_json: { ...(parsed.frontmatter || {}), name: parsed.name },
                compat_flags: {
                    ...(saved.compat_flags || {}),
                    asset_count: assetPaths.length,
                    entry_paths: extracted.paths.slice(0, 50),
                },
            }),
        };
        const report = assessSkillCompat({
            name: saved.name,
            description: saved.description,
            body_md: saved.body_md,
            frontmatter: saved.frontmatter_json,
            entry_paths: extracted.paths,
            asset_paths: assetPaths,
        });
        saved.compat_grade = report.grade;
        saved.compat_report_json = report as unknown as Record<string, unknown>;
        return this.repo().save(saved);
    }

    /** Agent / 节点注入用正文：优先适配版 */
    bodyForRuntime(row: SkillDefinition): string {
        const adapted = String(row.adapted_body_md || "").trim();
        if (adapted) return adapted;
        return row.body_md || "";
    }

    async ensureCompatReport(row: SkillDefinition): Promise<CompatReport> {
        if (row.compat_report_json && (row.compat_report_json as any).grade) {
            return row.compat_report_json as unknown as CompatReport;
        }
        const entryPaths = Array.isArray(row.compat_flags?.entry_paths)
            ? (row.compat_flags!.entry_paths as unknown[]).map(String)
            : [];
        const report = assessSkillCompat({
            name: row.name,
            description: row.description,
            body_md: row.body_md,
            frontmatter: row.frontmatter_json ?? null,
            entry_paths: entryPaths,
            asset_paths: Array.isArray(row.assets_json) ? row.assets_json.map(String) : [],
        });
        row.compat_grade = report.grade;
        row.compat_report_json = report as unknown as Record<string, unknown>;
        await this.repo().save(row);
        return report;
    }

    async reassessCompat(userId: number, skillId: number, isAdmin: boolean): Promise<CompatReport> {
        const row = isAdmin
            ? await this.getForAdmin(skillId)
            : await this.getForUser(userId, skillId, { includeUnsupported: true });
        if (!isAdmin && Number(row.owner_user_id) !== Number(userId) && row.visibility !== "global") {
            throw new Error("无权操作该 Skill");
        }
        row.compat_report_json = null;
        return this.ensureCompatReport(row);
    }

    async adaptSkill(userId: number, skillId: number, isAdmin: boolean): Promise<{
        report: CompatReport;
        adapted: boolean;
        preview: string;
    }> {
        const row = isAdmin
            ? await this.getForAdmin(skillId)
            : await this.getForUser(userId, skillId, { includeUnsupported: true });
        if (!isAdmin && Number(row.owner_user_id) !== Number(userId)) {
            throw new Error("仅上传人可对私有 Skill 执行适配改造");
        }
        const entryPaths = Array.isArray(row.compat_flags?.entry_paths)
            ? (row.compat_flags!.entry_paths as unknown[]).map(String)
            : [];
        const assetPaths = Array.isArray(row.assets_json) ? row.assets_json.map(String) : [];
        const staticReport = await this.ensureCompatReport(row);
        const { adapted_body_md, report } = await adaptSkillWithLlm({
            name: row.name,
            description: row.description,
            body_md: row.body_md,
            frontmatter: row.frontmatter_json ?? null,
            entry_paths: entryPaths,
            asset_paths: assetPaths,
            staticReport,
        });
        row.adapted_body_md = adapted_body_md;
        row.compat_grade = report.grade;
        row.compat_report_json = report as unknown as Record<string, unknown>;
        row.adapted_at = new Date();
        await this.repo().save(row);
        return {
            report,
            adapted: true,
            preview: adapted_body_md.slice(0, 2000),
        };
    }

    /** 从 zip 抽出 references|assets 下的文本文件到 uploads，返回相对路径列表 */
    private async materializeTextAssets(
        row: SkillDefinition,
        packageBuffer: Buffer,
        packageExt: string
    ): Promise<string[]> {
        if (packageExt !== ".zip") return [];
        const zip = new AdmZip(packageBuffer);
        const out: string[] = [];
        const scopeDir = `u/${row.owner_user_id}`;
        for (const e of zip.getEntries()) {
            if (e.isDirectory) continue;
            const full = e.entryName.replace(/\\/g, "/");
            const rel = full.includes("/") ? full.replace(/^[^/]+\//, "") : full;
            if (!/^(references|assets)\//i.test(rel)) continue;
            if (!/\.(md|txt|json|csv|ya?ml)$/i.test(rel)) continue;
            const data = e.getData();
            if (!data?.length || data.length > 256 * 1024) continue;
            const logical = `/uploads/skills/${scopeDir}/${row.id}/files/${rel}`;
            await saveBuffer(logical, data, "text/plain; charset=utf-8");
            out.push(rel);
        }
        return out.slice(0, 40);
    }

    async listAssets(userId: number, skillId: number): Promise<{ path: string; kind: "text" }[]> {
        const row = await this.getForUser(userId, skillId, { includeUnsupported: true });
        let paths = Array.isArray(row.assets_json) ? row.assets_json.map(String) : [];
        if (!paths.length && row.package_key?.endsWith(".zip")) {
            try {
                const buf = await readPackageBuffer(row.package_key);
                paths = await this.materializeTextAssets(row, buf, ".zip");
                if (paths.length) {
                    row.assets_json = paths;
                    await this.repo().save(row);
                }
            } catch {
                /* ignore */
            }
        }
        return paths.map((p) => ({ path: p, kind: "text" as const }));
    }

    async readAssetText(
        userId: number,
        skillId: number,
        assetPath: string,
        maxChars = 6000
    ): Promise<{ path: string; content: string; truncated: boolean }> {
        const row = await this.getForUser(userId, skillId, { includeUnsupported: true });
        const normalized = String(assetPath || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/\.\./g, "");
        if (!/^(references|assets)\//i.test(normalized)) {
            throw new Error("仅允许读取 references/ 或 assets/ 下文件");
        }
        const scopeDir = `u/${row.owner_user_id}`;
        const logical = `/uploads/skills/${scopeDir}/${row.id}/files/${normalized}`;
        let text = "";
        try {
            const buf = await readPackageBuffer(logical);
            text = buf.toString("utf8");
        } catch {
            // 回退：直接从原 zip 读
            if (!row.package_key) throw new Error("附件不存在");
            const pkg = await readPackageBuffer(row.package_key);
            if (!row.package_key.endsWith(".zip")) throw new Error("附件不存在");
            const zip = new AdmZip(pkg);
            const entry =
                zip.getEntries().find((e) => {
                    const full = e.entryName.replace(/\\/g, "/");
                    const rel = full.includes("/") ? full.replace(/^[^/]+\//, "") : full;
                    return rel === normalized;
                }) || null;
            if (!entry) throw new Error("附件不存在");
            text = entry.getData().toString("utf8");
        }
        const truncated = text.length > maxChars;
        return {
            path: normalized,
            content: truncated ? text.slice(0, maxChars) + "\n\n…(已截断)" : text,
            truncated,
        };
    }

    /** 普通用户可选+可管理：global active + 自己的 private/draft/disabled */
    async listForUser(userId: number): Promise<SkillListItem[]> {
        this.assertEnabled();
        // 兼容旧数据：本人名下的 draft 自动升为 private，上传人立即可用
        await this.repo()
            .createQueryBuilder()
            .update(SkillDefinition)
            .set({ visibility: "private" })
            .where("owner_user_id = :uid AND visibility = :draft", { uid: userId, draft: "draft" })
            .execute();

        await this.healHubGuiUnsupportedSkills(userId);

        const rows = await this.repo()
            .createQueryBuilder("s")
            .where(
                "(s.visibility = :global AND s.status = :active) OR (s.owner_user_id = :uid AND s.visibility IN (:...mineVis) AND s.status IN (:...mineStatus))",
                {
                    global: "global",
                    active: "active",
                    uid: userId,
                    mineVis: ["private", "disabled", "draft"],
                    mineStatus: ["active", "unsupported"],
                }
            )
            .orderBy("s.updated_at", "DESC")
            .getMany();
        return rows.map((r) => toListItem(r, userId));
    }

    /** 超管：全部（含 draft/disabled/unsupported） */
    async listForAdmin(): Promise<SkillListItem[]> {
        this.assertEnabled();
        await this.healHubGuiUnsupportedSkills();
        const rows = await this.repo().find({ order: { updated_at: "DESC" } });
        return rows.map((r) => toListItem(r, Number(r.owner_user_id)));
    }

    /**
     * 旧导入：scripts/*.js Hub GUI 被误标 unsupported。
     * 本产品不执行脚本，无 py/sh 等可执行脚本时恢复 active。
     */
    private async healHubGuiUnsupportedSkills(ownerUserId?: number): Promise<void> {
        const qb = this.repo()
            .createQueryBuilder("s")
            .where("s.status = :st", { st: "unsupported" });
        if (ownerUserId != null) {
            qb.andWhere("s.owner_user_id = :uid", { uid: ownerUserId });
        }
        const rows = await qb.getMany();
        for (const row of rows) {
            const paths = Array.isArray(row.compat_flags?.entry_paths)
                ? (row.compat_flags!.entry_paths as unknown[]).map(String)
                : [];
            if (!paths.length) continue;
            if (detectExecutableScripts(paths)) continue;
            if (!detectHasScripts(paths)) continue;
            row.status = "active";
            row.compat_flags = {
                ...(row.compat_flags || {}),
                has_scripts: true,
                has_executable_scripts: false,
                has_hub_gui: true,
                healed_from_unsupported: true,
            };
            await this.repo().save(row);
        }
    }

    async getForUser(userId: number, skillId: number, opts?: { includeUnsupported?: boolean }): Promise<SkillDefinition> {
        this.assertEnabled();
        const row = await this.repo().findOne({ where: { id: skillId } });
        if (!row) throw new Error("Skill 不存在");
        const okGlobal = row.visibility === "global" && (row.status === "active" || opts?.includeUnsupported);
        const okMine =
            Number(row.owner_user_id) === Number(userId) &&
            (row.visibility === "private" || row.visibility === "draft") &&
            (row.status === "active" || opts?.includeUnsupported);
        if (!okGlobal && !okMine) {
            throw new Error("无权访问该 Skill");
        }
        return row;
    }

    async getForAdmin(skillId: number): Promise<SkillDefinition> {
        this.assertEnabled();
        const row = await this.repo().findOne({ where: { id: skillId } });
        if (!row) throw new Error("Skill 不存在");
        return row;
    }

    truncateBody(body: string): string {
        if (body.length <= SKILL_BODY_INJECT_MAX_CHARS) return body;
        return body.slice(0, SKILL_BODY_INJECT_MAX_CHARS) + "\n\n…(已截断)";
    }

    /** 运行时正文截断（适配版优先） */
    truncateRuntimeBody(row: SkillDefinition): string {
        return this.truncateBody(this.bodyForRuntime(row));
    }

    async patchPrivate(
        userId: number,
        skillId: number,
        patch: { name?: string; description?: string; visibility?: "private" | "disabled" }
    ): Promise<SkillDefinition> {
        this.assertEnabled();
        const row = await this.repo().findOne({ where: { id: skillId } });
        if (!row) throw new Error("Skill 不存在");
        if (row.visibility !== "private" && row.visibility !== "disabled") {
            throw new Error("只能修改自己的私有 Skill");
        }
        if (Number(row.owner_user_id) !== Number(userId)) {
            throw new Error("无权修改该 Skill");
        }
        if (patch.visibility !== undefined && patch.visibility !== "private" && patch.visibility !== "disabled") {
            throw new Error("不能将私有 Skill 设为全员可见");
        }
        if (patch.name !== undefined) row.name = String(patch.name).trim().toLowerCase();
        if (patch.description !== undefined) row.description = String(patch.description).trim();
        if (patch.visibility === "private" || patch.visibility === "disabled") {
            row.visibility = patch.visibility;
        }
        return this.repo().save(row);
    }

    async deleteOwned(userId: number, skillId: number, isAdmin: boolean): Promise<void> {
        this.assertEnabled();
        const row = await this.repo().findOne({ where: { id: skillId } });
        if (!row) throw new Error("Skill 不存在");
        if (!isAdmin && Number(row.owner_user_id) !== Number(userId)) {
            throw new Error("无权删除该 Skill");
        }
        if (!isAdmin && row.visibility === "global") {
            throw new Error("无权删除全员 Skill");
        }
        await this.repo().remove(row);
    }

    async adminSetVisibility(skillId: number, visibility: SkillVisibility): Promise<SkillDefinition> {
        this.assertEnabled();
        const row = await this.getForAdmin(skillId);
        if (!["global", "private", "disabled"].includes(visibility)) {
            throw new Error("visibility 须为 global|private|disabled");
        }
        row.visibility = visibility;
        return this.repo().save(row);
    }

    async downloadPackage(userId: number, skillId: number, isAdmin: boolean): Promise<{ buffer: Buffer; fileName: string }> {
        this.assertEnabled();
        const row = isAdmin
            ? await this.getForAdmin(skillId)
            : await this.getForUser(userId, skillId, { includeUnsupported: true });
        if (!isAdmin && Number(row.owner_user_id) !== Number(userId) && row.visibility !== "global") {
            // getForUser already gates; global users can download package of global skills
        }
        if (!isAdmin && row.visibility === "private" && Number(row.owner_user_id) !== Number(userId)) {
            throw new Error("无权下载");
        }
        if (!row.package_key) throw new Error("原包不存在");
        const buffer = await readPackageBuffer(row.package_key);
        const ext = row.package_key.endsWith(".md") ? ".md" : ".zip";
        return { buffer, fileName: `${row.name}${ext}` };
    }

    async summarizeForAgent(userId: number): Promise<{ id: number; name: string; description: string }[]> {
        const list = await this.listForUser(userId);
        return list
            .filter(
                (s) =>
                    s.status === "active" &&
                    (s.visibility === "global" || s.visibility === "private" || s.visibility === "draft")
            )
            .map((s) => ({ id: s.id, name: s.name, description: s.description }));
    }
}
