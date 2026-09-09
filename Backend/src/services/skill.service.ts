import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { AppDataSource } from "../data-source";
import { SkillDefinition, SkillStatus, SkillVisibility } from "../entities/SkillDefinition";
import { isCosEnabled, pathToKey, upload as cosUpload, getFileContent } from "./cos.service";
import { detectHasScripts, parseSkillMarkdown } from "../skills/parse-skill-md";
import {
    SKILL_BODY_INJECT_MAX_CHARS,
    SKILL_PRIVATE_QUOTA_DEFAULT,
    SKILL_ZIP_MAX_BYTES,
} from "../skills/workflow-agent.tools";

export type SkillImportMode = "private" | "admin_global";

export type SkillListItem = {
    id: number;
    name: string;
    description: string;
    visibility: SkillVisibility;
    status: SkillStatus;
    owner_user_id: number;
    compat_flags: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
    group: "global" | "mine" | "draft" | "other";
};

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
    else if (row.visibility === "private" && Number(row.owner_user_id) === Number(viewerId)) group = "mine";
    else if (row.visibility === "draft") group = "draft";
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        visibility: row.visibility,
        status: row.status,
        owner_user_id: Number(row.owner_user_id),
        compat_flags: (row.compat_flags as Record<string, unknown>) || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        group,
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
        const status: SkillStatus = hasScripts ? "unsupported" : "active";
        const visibility: SkillVisibility = mode === "private" ? "private" : "draft";

        if (mode === "private") {
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
            compat_flags: { has_scripts: hasScripts, entry_paths: extracted.paths.slice(0, 50) },
            assets_json: [],
        });
        const saved = await this.repo().save(row);

        const scopeDir = mode === "private" ? `u/${userId}` : "global";
        const logical = `/uploads/skills/${scopeDir}/${saved.id}/package${extracted.packageExt}`;
        const ctype = extracted.packageExt === ".zip" ? "application/zip" : "text/markdown; charset=utf-8";
        await saveBuffer(logical, extracted.packageBuffer, ctype);
        saved.package_key = logical;
        return this.repo().save(saved);
    }

    /** 普通用户可选+可管理列表：global active + 自己的 private/disabled（不含 unsupported） */
    async listForUser(userId: number): Promise<SkillListItem[]> {
        this.assertEnabled();
        const rows = await this.repo()
            .createQueryBuilder("s")
            .where(
                "(s.visibility = :global AND s.status = :active) OR (s.owner_user_id = :uid AND s.visibility IN (:...mineVis) AND s.status IN (:...mineStatus))",
                {
                    global: "global",
                    active: "active",
                    uid: userId,
                    mineVis: ["private", "disabled"],
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
        const rows = await this.repo().find({ order: { updated_at: "DESC" } });
        return rows.map((r) => toListItem(r, Number(r.owner_user_id)));
    }

    async getForUser(userId: number, skillId: number, opts?: { includeUnsupported?: boolean }): Promise<SkillDefinition> {
        this.assertEnabled();
        const row = await this.repo().findOne({ where: { id: skillId } });
        if (!row) throw new Error("Skill 不存在");
        const okGlobal = row.visibility === "global" && (row.status === "active" || opts?.includeUnsupported);
        const okPrivate =
            row.visibility === "private" &&
            Number(row.owner_user_id) === Number(userId) &&
            (row.status === "active" || opts?.includeUnsupported);
        if (!okGlobal && !okPrivate) {
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
        if (visibility === "private") {
            throw new Error("请使用用户私有上传创建 private Skill");
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
            .filter((s) => s.status === "active" && (s.visibility === "global" || s.visibility === "private"))
            .map((s) => ({ id: s.id, name: s.name, description: s.description }));
    }
}
