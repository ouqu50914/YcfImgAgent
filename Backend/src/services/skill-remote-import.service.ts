import axios from "axios";
import JSZip from "jszip";
import {
    detectAndParseSkillMarkdown,
    parseAgentSkillMarkdown,
    parsedAgentToSkillInput,
    type ParsedAgentSkill,
} from "../utils/agent-skill-parser.util";
import { SKILL_LIMITS, type SkillInput } from "../utils/skill-validation.util";
import {
    assessGenerationSkillUsability,
    assessMarketplaceSlug,
    type SkillUsabilityResult,
} from "../utils/skill-generation-usability.util";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export type MarketplaceSource = {
    id: string;
    name: string;
    description: string;
    homepage: string;
    standard: string;
};

export type MarketplaceItem = {
    slug: string;
    name: string;
    description?: string;
    installUrl: string;
    usable: boolean;
    usabilityReason: string;
};

export type SkillImportPreviewItem = {
    skill: SkillInput;
    usability: SkillUsabilityResult;
};

type GitHubRef = {
    owner: string;
    repo: string;
    branch: string;
    path: string;
};

const MARKETPLACE_SOURCES: MarketplaceSource[] = [
    {
        id: "anthropics-skills",
        name: "Anthropic 开源 Skills",
        description: "agentskills.io 示例库（已过滤：仅展示与本平台生图/生视频相关的 Skill）",
        homepage: "https://github.com/anthropics/skills",
        standard: "agentskills.io",
    },
];

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
}

function parseGitHubUrl(input: string): GitHubRef | null {
    try {
        const u = new URL(input.trim());
        if (u.hostname !== "github.com") return null;

        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;

        const owner = parts[0]!;
        const repo = parts[1]!.replace(/\.git$/, "");

        if (parts[2] === "blob" && parts.length >= 5) {
            const branch = parts[3]!;
            const path = parts.slice(4).join("/");
            return { owner, repo, branch, path };
        }

        if (parts[2] === "tree" && parts.length >= 4) {
            const branch = parts[3]!;
            const path = parts.slice(4).join("/");
            return { owner, repo, branch, path };
        }

        return { owner, repo, branch: "main", path: "" };
    } catch {
        return null;
    }
}

function toRawGitHubUrl(ref: GitHubRef, filePath: string): string {
    const path = [ref.path, filePath].filter(Boolean).join("/").replace(/^\/+/, "");
    return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.branch}/${path}`;
}

function githubTreeInstallUrl(ref: GitHubRef): string {
    const path = ref.path ? `/${ref.path}` : "";
    return `https://github.com/${ref.owner}/${ref.repo}/tree/${ref.branch}${path}`;
}

async function fetchText(url: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<string> {
    const res = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: FETCH_TIMEOUT_MS,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        headers: {
            Accept: "text/plain, text/markdown, application/json, */*",
            "User-Agent": "YcfImgAgent-SkillImporter/1.0",
        },
        validateStatus: (s) => s >= 200 && s < 300,
    });

    const buf = Buffer.from(res.data);
    if (buf.length > maxBytes) {
        throw new Error(`下载内容超过 ${maxBytes / 1024 / 1024}MB 限制`);
    }
    return buf.toString("utf-8");
}

async function fetchBuffer(url: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<Buffer> {
    const res = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: FETCH_TIMEOUT_MS,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        headers: { "User-Agent": "YcfImgAgent-SkillImporter/1.0" },
        validateStatus: (s) => s >= 200 && s < 300,
    });
    const buf = Buffer.from(res.data);
    if (buf.length > maxBytes) {
        throw new Error(`下载内容超过 ${maxBytes / 1024 / 1024}MB 限制`);
    }
    return buf;
}

function collectReferenceTexts(files: Record<string, string>): string {
    const parts: string[] = [];
    const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));

    for (const [path, text] of entries) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        const name = path.split("/").pop() || path;
        parts.push(`### ${name}\n${trimmed.slice(0, 4000)}`);
    }

    return parts.join("\n\n").slice(0, 8000);
}

async function parseZipBuffer(buffer: Buffer, sourceUrl: string): Promise<ParsedAgentSkill[]> {
    const zip = await JSZip.loadAsync(buffer);
    const drafts: ParsedAgentSkill[] = [];

    const skillMdPaths = Object.keys(zip.files).filter(
        (p) => !zip.files[p]!.dir && /(^|\/)SKILL\.md$/i.test(p.replace(/\\/g, "/"))
    );

    if (skillMdPaths.length === 0) {
        throw new Error("ZIP 中未找到 SKILL.md（Agent Skills 标准目录结构）");
    }

    for (const skillPath of skillMdPaths) {
        const normalized = skillPath.replace(/\\/g, "/");
        const folder = normalized.replace(/\/?SKILL\.md$/i, "");
        const skillText = await zip.files[skillPath]!.async("string");

        const refFiles: Record<string, string> = {};
        for (const entryPath of Object.keys(zip.files)) {
            if (zip.files[entryPath]!.dir) continue;
            const entryNorm = entryPath.replace(/\\/g, "/");
            const prefix = folder ? `${folder}/` : "";
            if (!entryNorm.startsWith(prefix) || entryNorm === normalized) continue;

            const rel = entryNorm.slice(prefix.length);
            if (/^references?\//i.test(rel) && /\.(md|txt|markdown)$/i.test(rel)) {
                refFiles[rel] = await zip.files[entryPath]!.async("string");
            }
            const refNames = ["reference.md", "examples.md", "reference.txt", "examples.txt"];
            if (refNames.some((n) => entryNorm.endsWith(`/${n}`) || entryNorm === n)) {
                refFiles[rel || entryNorm] = await zip.files[entryPath]!.async("string");
            }
        }

        const fallbackName = folder.split("/").filter(Boolean).pop() || "skill";
        const parsed =
            detectAndParseSkillMarkdown(skillText, fallbackName, {
                sourcePath: normalized,
                sourceUrl,
                referenceAppend: collectReferenceTexts(refFiles),
            }) ||
            parseAgentSkillMarkdown(skillText, {
                sourcePath: normalized,
                sourceUrl,
                fallbackName,
                referenceAppend: collectReferenceTexts(refFiles),
            });

        drafts.push(parsed);
    }

    if (drafts.length > SKILL_LIMITS.IMPORT_BATCH_MAX) {
        throw new Error(`单次最多导入 ${SKILL_LIMITS.IMPORT_BATCH_MAX} 个 Skill`);
    }

    return drafts;
}

async function fetchGitHubDirectorySkillMd(ref: GitHubRef, sourceUrl: string): Promise<ParsedAgentSkill[]> {
    const skillMdUrl = toRawGitHubUrl(ref, "SKILL.md");
    let skillText: string;
    try {
        skillText = await fetchText(skillMdUrl);
    } catch {
        throw new Error(`未找到 SKILL.md：${skillMdUrl}`);
    }

    const refFiles: Record<string, string> = {};
    const referencesUrl = `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${ref.path ? `${ref.path}/references` : "references"}?ref=${ref.branch}`;

    try {
        const res = await axios.get<Array<{ name: string; download_url?: string; type: string }>>(
            referencesUrl,
            {
                timeout: FETCH_TIMEOUT_MS,
                headers: {
                    Accept: "application/vnd.github+json",
                    "User-Agent": "YcfImgAgent-SkillImporter/1.0",
                },
            }
        );
        if (Array.isArray(res.data)) {
            for (const item of res.data) {
                if (item.type !== "file" || !item.download_url) continue;
                if (!/\.(md|txt|markdown)$/i.test(item.name)) continue;
                try {
                    refFiles[`references/${item.name}`] = await fetchText(item.download_url, 512 * 1024);
                } catch {
                    // skip failed reference file
                }
            }
        }
    } catch {
        // references/ 可选
    }

    const fallbackName = ref.path.split("/").filter(Boolean).pop() || ref.repo;
    const parsed =
        detectAndParseSkillMarkdown(skillText, fallbackName, {
            sourcePath: ref.path ? `${ref.path}/SKILL.md` : "SKILL.md",
            sourceUrl,
            referenceAppend: collectReferenceTexts(refFiles),
        }) ||
        parseAgentSkillMarkdown(skillText, {
            sourcePath: ref.path ? `${ref.path}/SKILL.md` : "SKILL.md",
            sourceUrl,
            fallbackName,
            referenceAppend: collectReferenceTexts(refFiles),
        });

    return [parsed];
}

async function resolveUrlToSkills(inputUrl: string): Promise<ParsedAgentSkill[]> {
    const url = stripTrailingSlash(inputUrl.trim());
    if (!url) throw new Error("URL 不能为空");

    if (/\.zip(\?|$)/i.test(url)) {
        const buffer = await fetchBuffer(url);
        return parseZipBuffer(buffer, url);
    }

    const gh = parseGitHubUrl(url);
    if (gh) {
        const installUrl = githubTreeInstallUrl(gh);
        const lowerPath = gh.path.toLowerCase();

        if (lowerPath.endsWith("skill.md")) {
            const rawUrl = toRawGitHubUrl({ ...gh, path: "" }, gh.path);
            const text = await fetchText(rawUrl);
            const fallbackName = gh.path.split("/").pop()?.replace(/\.md$/i, "") || gh.repo;
            const parsed =
                detectAndParseSkillMarkdown(text, fallbackName, { sourceUrl: url, sourcePath: gh.path }) ||
                parseAgentSkillMarkdown(text, { sourceUrl: url, sourcePath: gh.path, fallbackName });
            return [parsed];
        }

        if (gh.path) {
            return fetchGitHubDirectorySkillMd(gh, installUrl);
        }

        const skillsListUrl = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/skills?ref=${gh.branch}`;
        try {
            const res = await axios.get<Array<{ name: string; type: string; path: string }>>(skillsListUrl, {
                timeout: FETCH_TIMEOUT_MS,
                headers: {
                    Accept: "application/vnd.github+json",
                    "User-Agent": "YcfImgAgent-SkillImporter/1.0",
                },
            });
            const dirs = (res.data || []).filter((x) => x.type === "dir");
            if (dirs.length === 0) {
                throw new Error("仓库根目录未找到 skills/ 子目录，请指定具体 Skill 目录 URL");
            }
            const all: ParsedAgentSkill[] = [];
            for (const dir of dirs.slice(0, SKILL_LIMITS.IMPORT_BATCH_MAX)) {
                const subRef: GitHubRef = { ...gh, path: dir.path };
                const items = await fetchGitHubDirectorySkillMd(subRef, githubTreeInstallUrl(subRef));
                all.push(...items);
            }
            if (all.length > SKILL_LIMITS.IMPORT_BATCH_MAX) {
                throw new Error(`单次最多导入 ${SKILL_LIMITS.IMPORT_BATCH_MAX} 个 Skill`);
            }
            return all;
        } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("单次最多")) throw err;
            throw new Error("请提供 SKILL.md 直链、Skill 目录或 ZIP 地址");
        }
    }

    if (/raw\.githubusercontent\.com/i.test(url) || /\/SKILL\.md(\?|$)/i.test(url) || /\.md(\?|$)/i.test(url)) {
        const text = await fetchText(url);
        const fallbackName =
            url.split("/").pop()?.replace(/\.md(\?.*)?$/i, "") || "skill";
        const parsed =
            detectAndParseSkillMarkdown(text, fallbackName, { sourceUrl: url }) ||
            parseAgentSkillMarkdown(text, { sourceUrl: url, fallbackName });
        return [parsed];
    }

    throw new Error(
        "不支持的 URL。请使用：GitHub Skill 目录、SKILL.md 直链（raw.githubusercontent.com）或 .zip 地址"
    );
}

export class SkillRemoteImportService {
    listMarketplaceSources(): MarketplaceSource[] {
        return MARKETPLACE_SOURCES;
    }

    async listMarketplaceItems(sourceId: string): Promise<MarketplaceItem[]> {
        if (sourceId !== "anthropics-skills") {
            throw new Error("未知的技能源");
        }

        const res = await axios.get<Array<{ name: string; type: string; path: string }>>(
            "https://api.github.com/repos/anthropics/skills/contents/skills?ref=main",
            {
                timeout: FETCH_TIMEOUT_MS,
                headers: {
                    Accept: "application/vnd.github+json",
                    "User-Agent": "YcfImgAgent-SkillImporter/1.0",
                },
            }
        );

        const dirs = (res.data || []).filter((x) => x.type === "dir");
        const items: MarketplaceItem[] = [];

        for (const dir of dirs) {
            const installUrl = `https://github.com/anthropics/skills/tree/main/${dir.path}`;
            let description: string | undefined;
            try {
                const skillUrl = `https://raw.githubusercontent.com/anthropics/skills/main/${dir.path}/SKILL.md`;
                const head = (await fetchText(skillUrl, 8192)).slice(0, 4096);
                const match = head.match(/^---[\s\S]*?description:\s*(?:>\s*\n([\s\S]*?)\n\w|\s*["']?([^"'\n]+))/m);
                description = (match?.[1] || match?.[2])?.trim().slice(0, 200);
            } catch {
                // optional
            }

            const slugCheck = assessMarketplaceSlug(dir.name);
            items.push({
                slug: dir.name,
                name: dir.name
                    .split("-")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" "),
                installUrl,
                usable: slugCheck.usable,
                usabilityReason: slugCheck.reason,
                ...(description ? { description } : {}),
            });
        }

        return items.filter((x) => x.usable);
    }

    async previewRemote(url: string): Promise<SkillImportPreviewItem[]> {
        const parsed = await resolveUrlToSkills(url);
        return parsed.map((p) => {
            const skill = parsedAgentToSkillInput(p) as SkillInput;
            return {
                skill,
                usability: assessGenerationSkillUsability(skill),
            };
        });
    }

    async importRemote(url: string): Promise<SkillInput[]> {
        const previews = await this.previewRemote(url);
        const blocked = previews.filter((x) => !x.usability.usable);
        if (blocked.length > 0) {
            const names = blocked.map((b) => b.skill.name || "未命名").join("、");
            throw new Error(
                `以下 Skill 无法在本平台使用：${names}。${blocked[0]!.usability.reason}`
            );
        }
        return previews.map((x) => x.skill);
    }
}
