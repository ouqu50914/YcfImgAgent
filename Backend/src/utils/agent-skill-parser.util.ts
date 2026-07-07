import type {
    GenerationSkillApplyMode,
    GenerationSkillFormat,
    GenerationSkillScope,
} from "../entities/GenerationSkill";

/** Agent Skills 开放标准（agentskills.io）解析结果 */
export type ParsedAgentSkill = {
    slug: string;
    name: string;
    description: string;
    content: string;
    scope: GenerationSkillScope;
    applyMode: GenerationSkillApplyMode;
    metadata: Record<string, unknown>;
    sourcePath?: string;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unquote(value: string): string {
    const t = value.trim();
    if (
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))
    ) {
        return t.slice(1, -1);
    }
    return t;
}

/** 解析 YAML frontmatter（支持 description 多行折叠块 >） */
export function parseYamlFrontmatter(text: string): {
    meta: Record<string, string>;
    body: string;
} {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: text };

    const meta: Record<string, string> = {};
    const lines = match[1]!.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            i++;
            continue;
        }
        const idx = trimmed.indexOf(":");
        if (idx <= 0) {
            i++;
            continue;
        }
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();

        if (value === ">" || value === "|") {
            const block: string[] = [];
            i++;
            while (i < lines.length) {
                const next = lines[i]!;
                if (/^\S/.test(next) && next.includes(":")) break;
                if (next.trim() === "" && block.length > 0) {
                    block.push("");
                    i++;
                    continue;
                }
                if (/^\s+/.test(next) || next.trim() === "") {
                    block.push(next.replace(/^\s{2}/, ""));
                    i++;
                    continue;
                }
                break;
            }
            meta[key] = block.join("\n").trim();
            continue;
        }

        meta[key] = unquote(value);
        i++;
    }

    return { meta, body: (match[2] ?? "").trim() };
}

/** 是否符合 Agent Skills 标准 frontmatter（name + description 必填） */
export function isAgentSkillFrontmatter(meta: Record<string, string>): boolean {
    const name = meta.name?.trim() || "";
    const description = meta.description?.trim() || "";
    return SLUG_RE.test(name) && description.length > 0;
}

function slugToDisplayName(slug: string): string {
    return slug
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function extractInstructionBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return "";

    const instructionsMatch = trimmed.match(
        /(?:^|\n)#{1,3}\s*Instructions?\s*\n([\s\S]*?)(?=\n#{1,3}\s|\n#{1,3}\s*Examples?\s|\n#{1,3}\s*Scripts?\s|$)/i
    );
    if (instructionsMatch?.[1]?.trim()) {
        return instructionsMatch[1].trim();
    }

    let content = trimmed.replace(/^#\s+[^\n]+\n?/, "").trim();
    content = content.replace(
        /\n#{1,3}\s*(Examples?|Scripts?|Additional Resources|Before You Begin)[\s\S]*$/i,
        ""
    );
    return content.trim() || trimmed;
}

function normalizeScope(raw?: string): GenerationSkillScope {
    if (raw === "image" || raw === "video" || raw === "both") return raw;
    return "both";
}

function inferScopeFromDescription(description: string): GenerationSkillScope {
    const d = description.toLowerCase();
    const hasImage = /image|生图|picture|photo|midjourney|seedream|nano/.test(d);
    const hasVideo = /video|生视频|seedance|pixverse|kling|镜头|运镜/.test(d);
    if (hasImage && !hasVideo) return "image";
    if (hasVideo && !hasImage) return "video";
    return "both";
}

function buildAgentMetadata(
    meta: Record<string, string>,
    slug: string,
    description: string,
    sourceUrl?: string
): Record<string, unknown> {
    const agentMeta: Record<string, unknown> = {
        slug,
        description,
        standard: "agentskills.io",
        imported_at: new Date().toISOString(),
    };
    if (meta.license) agentMeta.license = meta.license;
    if (meta.compatibility) agentMeta.compatibility = meta.compatibility;
    if (meta["allowed-tools"]) agentMeta.allowed_tools = meta["allowed-tools"];
    if (meta["disable-model-invocation"] === "true") {
        agentMeta.disable_model_invocation = true;
    }
    if (sourceUrl) agentMeta.source_url = sourceUrl;

    return { agent_skill: agentMeta };
}

export function parseAgentSkillMarkdown(
    text: string,
    options?: {
        sourcePath?: string;
        sourceUrl?: string;
        fallbackName?: string;
        referenceAppend?: string;
    }
): ParsedAgentSkill {
    const { meta, body } = parseYamlFrontmatter(text);
    const slug = meta.name?.trim() || options?.fallbackName || "skill";
    const description = meta.description?.trim() || "";

    const headingMatch = body.match(/^#\s+(.+?)\s*$/m);
    const displayName = headingMatch?.[1]?.trim() || slugToDisplayName(slug);

    let content = extractInstructionBody(body);
    if (options?.referenceAppend?.trim()) {
        content = `${content}\n\n---\n\n## Reference\n${options.referenceAppend.trim()}`;
    }

    const scope = normalizeScope(meta.scope) || inferScopeFromDescription(description);
    const metadata = buildAgentMetadata(meta, slug, description, options?.sourceUrl);

    const result: ParsedAgentSkill = {
        slug,
        name: displayName.slice(0, 100),
        description: description.slice(0, 200),
        content,
        scope,
        applyMode: "preprocess",
        metadata,
    };
    if (options?.sourcePath) result.sourcePath = options.sourcePath;
    return result;
}

export function detectAndParseSkillMarkdown(
    text: string,
    fallbackName: string,
    options?: { sourcePath?: string; sourceUrl?: string; referenceAppend?: string }
): ParsedAgentSkill | null {
    const { meta } = parseYamlFrontmatter(text);
    if (!isAgentSkillFrontmatter(meta)) return null;
    const parseOpts: {
        fallbackName: string;
        sourcePath?: string;
        sourceUrl?: string;
        referenceAppend?: string;
    } = { fallbackName };
    if (options?.sourcePath) parseOpts.sourcePath = options.sourcePath;
    if (options?.sourceUrl) parseOpts.sourceUrl = options.sourceUrl;
    if (options?.referenceAppend) parseOpts.referenceAppend = options.referenceAppend;
    return parseAgentSkillMarkdown(text, parseOpts);
}

export function parsedAgentToSkillInput(parsed: ParsedAgentSkill) {
    const input: Record<string, unknown> = {
        name: parsed.name,
        content: parsed.content,
        scope: parsed.scope,
        format: "agent_skill" as GenerationSkillFormat,
        apply_mode: parsed.applyMode,
        metadata_json: JSON.stringify(parsed.metadata),
    };
    if (parsed.description) input.description = parsed.description;
    if (parsed.sourcePath) input.source_path = parsed.sourcePath;
    return input;
}

/** 兼容旧命名 */
export type ParsedCursorSkill = ParsedAgentSkill;
export const isCursorSkillFrontmatter = isAgentSkillFrontmatter;
export const parseCursorSkillMarkdown = parseAgentSkillMarkdown;
export const parsedCursorToSkillInput = parsedAgentToSkillInput;
