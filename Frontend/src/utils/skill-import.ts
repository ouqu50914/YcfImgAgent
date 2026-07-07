import type {
    CreateSkillParams,
    GenerationSkillApplyMode,
    GenerationSkillFormat,
    GenerationSkillScope,
} from '@/api/skill';
import { isAgentSkillFormat } from '@/api/skill';

export const SKILL_LIMITS = {
    NAME_MAX: 100,
    CONTENT_MAX: 20000,
    DESCRIPTION_MAX: 200,
    IMPORT_BATCH_MAX: 50,
    IMPORT_FILE_MAX_BYTES: 5 * 1024 * 1024,
    ZIP_MAX_BYTES: 10 * 1024 * 1024,
} as const;

export const SKILL_IMPORT_ACCEPT = '.json,.md,.txt,.markdown,.zip';

export type ParsedSkillDraft = CreateSkillParams;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unquote(value: string): string {
    const t = value.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}

export function parseYamlFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: text };

    const meta: Record<string, string> = {};
    const lines = match[1].split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            i++;
            continue;
        }
        const idx = trimmed.indexOf(':');
        if (idx <= 0) {
            i++;
            continue;
        }
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();

        if (value === '>' || value === '|') {
            const block: string[] = [];
            i++;
            while (i < lines.length) {
                const next = lines[i];
                if (/^\S/.test(next) && next.includes(':')) break;
                if (/^\s+/.test(next) || next.trim() === '') {
                    block.push(next.replace(/^\s{2}/, ''));
                    i++;
                    continue;
                }
                break;
            }
            meta[key] = block.join('\n').trim();
            continue;
        }

        meta[key] = unquote(value);
        i++;
    }

    return { meta, body: match[2].trim() };
}

export function isAgentSkillFrontmatter(meta: Record<string, string>): boolean {
    const name = meta.name?.trim() || '';
    const description = meta.description?.trim() || '';
    return SLUG_RE.test(name) && description.length > 0;
}

/** @deprecated 使用 isAgentSkillFrontmatter */
export const isCursorSkillFrontmatter = isAgentSkillFrontmatter;

function slugToDisplayName(slug: string): string {
    return slug
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function extractInstructionBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return '';

    const instructionsMatch = trimmed.match(
        /(?:^|\n)#{1,3}\s*Instructions?\s*\n([\s\S]*?)(?=\n#{1,3}\s|\n#{1,3}\s*Examples?\s|\n#{1,3}\s*Scripts?\s|$)/i
    );
    if (instructionsMatch?.[1]?.trim()) return instructionsMatch[1].trim();

    let content = trimmed.replace(/^#\s+[^\n]+\n?/, '').trim();
    content = content.replace(
        /\n#{1,3}\s*(Examples?|Scripts?|Additional Resources|Before You Begin)[\s\S]*$/i,
        ''
    );
    return content.trim() || trimmed;
}

function normalizeScope(raw?: string): GenerationSkillScope | undefined {
    if (raw === 'image' || raw === 'video' || raw === 'both') return raw;
    return undefined;
}

function inferScopeFromDescription(description: string): GenerationSkillScope {
    const d = description.toLowerCase();
    const hasImage = /image|生图|picture|photo|midjourney|seedream|nano/.test(d);
    const hasVideo = /video|生视频|seedance|pixverse|kling|镜头|运镜/.test(d);
    if (hasImage && !hasVideo) return 'image';
    if (hasVideo && !hasImage) return 'video';
    return 'both';
}

export function parseAgentSkillMarkdown(
    text: string,
    options?: { sourcePath?: string; fallbackName?: string; referenceAppend?: string }
): ParsedSkillDraft {
    const { meta, body } = parseYamlFrontmatter(text);
    const slug = meta.name?.trim() || options?.fallbackName || 'skill';
    const description = meta.description?.trim() || '';
    const headingMatch = body.match(/^#\s+(.+?)\s*$/m);
    const displayName = headingMatch?.[1]?.trim() || slugToDisplayName(slug);

    let content = extractInstructionBody(body);
    if (options?.referenceAppend?.trim()) {
        content = `${content}\n\n---\n\n## Reference\n${options.referenceAppend.trim()}`;
    }
    if (content.length > SKILL_LIMITS.CONTENT_MAX) {
        content = content.slice(0, SKILL_LIMITS.CONTENT_MAX);
    }

    const scope = normalizeScope(meta.scope) || inferScopeFromDescription(description);
    const metadata = {
        agent_skill: {
            slug,
            description,
            standard: 'agentskills.io',
            disable_model_invocation: meta['disable-model-invocation'] === 'true',
            imported_at: new Date().toISOString(),
        },
    };

    return {
        name: displayName.slice(0, SKILL_LIMITS.NAME_MAX),
        content,
        scope,
        description: description.slice(0, SKILL_LIMITS.DESCRIPTION_MAX) || undefined,
        format: 'agent_skill',
        apply_mode: 'preprocess',
        metadata_json: JSON.stringify(metadata),
        source_path: options?.sourcePath,
    };
}

/** @deprecated 使用 parseAgentSkillMarkdown */
export const parseCursorSkillMarkdown = parseAgentSkillMarkdown;

function stripExtension(filename: string): string {
    return filename.replace(/\.(json|md|markdown|txt|zip)$/i, '');
}

function asSkillArray(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (Array.isArray(obj.skills)) return obj.skills;
        if (typeof obj.name === 'string' && typeof obj.content === 'string') return [obj];
    }
    throw new Error('JSON 格式无效：需为 Skill 对象、Skill 数组，或 { "skills": [...] }');
}

function toDraft(item: unknown, index: number): ParsedSkillDraft {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条不是有效对象`);
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const content = typeof o.content === 'string' ? o.content.trim() : '';
    const description =
        typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined;
    const scope = normalizeScope(typeof o.scope === 'string' ? o.scope : undefined);
    let format: GenerationSkillFormat = 'plain';
    if (o.format === 'agent_skill' || o.format === 'cursor_skill') format = 'agent_skill';
    else if (o.format === 'plain') format = 'plain';
    const apply_mode: GenerationSkillApplyMode =
        o.apply_mode === 'preprocess' || o.apply_mode === 'merge'
            ? o.apply_mode
            : isAgentSkillFormat(format)
              ? 'preprocess'
              : 'merge';

    if (!name) throw new Error(`第 ${index + 1} 条缺少 name`);
    if (!content) throw new Error(`第 ${index + 1} 条缺少 content`);

    return {
        name,
        content,
        format,
        apply_mode,
        ...(scope ? { scope } : {}),
        ...(description ? { description } : {}),
        ...(typeof o.metadata_json === 'string' ? { metadata_json: o.metadata_json } : {}),
        ...(typeof o.source_path === 'string' ? { source_path: o.source_path } : {}),
    };
}

export function parseSkillJson(text: string): ParsedSkillDraft[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('JSON 解析失败，请检查文件格式');
    }
    const arr = asSkillArray(parsed);
    if (arr.length > SKILL_LIMITS.IMPORT_BATCH_MAX) {
        throw new Error(`单次最多导入 ${SKILL_LIMITS.IMPORT_BATCH_MAX} 个 Skill`);
    }
    return arr.map((item, index) => toDraft(item, index));
}

export function parseSkillMarkdown(text: string, fallbackName: string): ParsedSkillDraft[] {
    const { meta } = parseYamlFrontmatter(text);
    if (isAgentSkillFrontmatter(meta)) {
        return [parseAgentSkillMarkdown(text, { fallbackName })];
    }

    const { meta: m, body } = parseYamlFrontmatter(text);
    const content = body.trim();
    if (!content) throw new Error('Markdown 正文不能为空');

    const headingMatch = content.match(/^#\s+(.+?)\s*$/m);
    const name = (m.name || headingMatch?.[1] || fallbackName).trim();
    const scope = normalizeScope(m.scope);
    const description = m.description?.trim() || undefined;

    return [{
        name,
        content: headingMatch ? content.replace(/^#\s+.+?\s*\n?/m, '').trim() || content : content,
        format: 'plain',
        apply_mode: 'merge',
        ...(scope ? { scope } : {}),
        ...(description ? { description } : {}),
    }];
}

export function parseSkillText(text: string, fallbackName: string): ParsedSkillDraft[] {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('文本内容不能为空');

    const lines = trimmed.split(/\r?\n/);
    const firstLine = lines[0]?.trim() || '';
    let name = fallbackName;
    let content = trimmed;

    if (firstLine.startsWith('# ')) {
        name = firstLine.slice(2).trim() || fallbackName;
        content = lines.slice(1).join('\n').trim();
    } else if (firstLine.startsWith('name:')) {
        name = firstLine.slice(5).trim() || fallbackName;
        content = lines.slice(1).join('\n').trim();
    }

    if (!content) throw new Error('文本正文不能为空');

    return [{ name, content, format: 'plain', apply_mode: 'merge' }];
}

async function collectZipReferences(
    zip: import('jszip'),
    folder: string,
    zipFiles: Record<string, import('jszip').JSZipObject>
): Promise<string> {
    const refParts: string[] = [];
    const refNames = ['reference.md', 'examples.md', 'reference.txt', 'examples.txt'];
    const prefix = folder ? `${folder}/` : '';

    for (const entryPath of Object.keys(zipFiles)) {
        if (zipFiles[entryPath].dir) continue;
        const entryNorm = entryPath.replace(/\\/g, '/');
        if (!entryNorm.startsWith(prefix)) continue;
        const rel = entryNorm.slice(prefix.length);
        if (/^references?\//i.test(rel) && /\.(md|txt|markdown)$/i.test(rel)) {
            const refText = await zipFiles[entryPath].async('string');
            if (refText.trim()) {
                const name = rel.split('/').pop() || rel;
                refParts.push(`### ${name}\n${refText.trim().slice(0, 4000)}`);
            }
        }
    }

    for (const refName of refNames) {
        const refPath = Object.keys(zipFiles).find((p) => {
            const n = p.replace(/\\/g, '/');
            return !zipFiles[p].dir && (n === `${folder}/${refName}` || n.endsWith(`/${refName}`));
        });
        if (refPath) {
            const refText = await zipFiles[refPath].async('string');
            if (refText.trim()) refParts.push(`### ${refName}\n${refText.trim().slice(0, 4000)}`);
        }
    }

    return refParts.join('\n\n').slice(0, 8000);
}

async function parseSkillZip(file: File): Promise<ParsedSkillDraft[]> {
    if (file.size > SKILL_LIMITS.ZIP_MAX_BYTES) {
        throw new Error(`ZIP 不能超过 ${SKILL_LIMITS.ZIP_MAX_BYTES / 1024 / 1024}MB`);
    }

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const drafts: ParsedSkillDraft[] = [];

    const skillMdPaths = Object.keys(zip.files).filter(
        (p) => !zip.files[p].dir && /(^|\/)SKILL\.md$/i.test(p.replace(/\\/g, '/'))
    );

    if (skillMdPaths.length === 0) {
        throw new Error('ZIP 中未找到 SKILL.md（Agent Skills 标准目录结构）');
    }

    for (const skillPath of skillMdPaths) {
        const normalized = skillPath.replace(/\\/g, '/');
        const folder = normalized.replace(/\/?SKILL\.md$/i, '');
        const skillText = await zip.files[skillPath].async('string');
        const referenceAppend = await collectZipReferences(zip, folder, zip.files);
        const fallbackName = folder.split('/').filter(Boolean).pop() || 'skill';
        drafts.push(
            parseAgentSkillMarkdown(skillText, {
                sourcePath: normalized,
                fallbackName,
                referenceAppend,
            })
        );
    }

    if (drafts.length > SKILL_LIMITS.IMPORT_BATCH_MAX) {
        throw new Error(`单次最多导入 ${SKILL_LIMITS.IMPORT_BATCH_MAX} 个 Skill`);
    }

    return drafts;
}

export function parseSkillFile(file: File): Promise<ParsedSkillDraft[]> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) return parseSkillZip(file);

    if (file.size > SKILL_LIMITS.IMPORT_FILE_MAX_BYTES) {
        return Promise.reject(
            new Error(`文件不能超过 ${SKILL_LIMITS.IMPORT_FILE_MAX_BYTES / 1024 / 1024}MB`)
        );
    }

    const fallbackName = stripExtension(file.name);

    return file.text().then((text) => {
        if (lower.endsWith('.json')) return parseSkillJson(text);
        if (lower.endsWith('.md') || lower.endsWith('.markdown')) return parseSkillMarkdown(text, fallbackName);
        if (lower.endsWith('.txt')) return parseSkillText(text, fallbackName);
        throw new Error('支持 .json / .md / .txt / .zip 文件');
    });
}

export function scopeLabel(scope: GenerationSkillScope): string {
    if (scope === 'image') return '仅生图';
    if (scope === 'video') return '仅生视频';
    return '生图 + 生视频';
}

export function formatLabel(format: GenerationSkillFormat | string): string {
    return isAgentSkillFormat(format) ? 'Agent Skills' : '纯文本';
}

export function applyModeLabel(mode: GenerationSkillApplyMode): string {
    return mode === 'preprocess' ? '智能预处理' : '直接合并';
}

export function exportSkillAsAgentMarkdown(skill: {
    name: string;
    content: string;
    scope?: GenerationSkillScope;
    description?: string;
    metadata_json?: string;
}): string {
    let slug = skill.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    let description = skill.description || '';

    if (skill.metadata_json) {
        try {
            const meta = JSON.parse(skill.metadata_json) as {
                agent_skill?: { slug?: string; description?: string };
                cursor?: { slug?: string; description?: string };
            };
            const src = meta.agent_skill || meta.cursor;
            if (src?.slug) slug = src.slug;
            if (src?.description) description = src.description;
        } catch {
            // ignore
        }
    }

    const scopeLine = skill.scope && skill.scope !== 'both' ? `scope: ${skill.scope}\n` : '';

    return `---
name: ${slug}
description: >-
  ${description.replace(/\n/g, ' ').trim() || skill.name}
${scopeLine}---

# ${skill.name}

## Instructions
${skill.content}
`;
}

/** @deprecated 使用 exportSkillAsAgentMarkdown */
export const exportSkillAsCursorMarkdown = exportSkillAsAgentMarkdown;

export { isAgentSkillFormat };
