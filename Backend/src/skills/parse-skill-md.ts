/**
 * 解析 SKILL.md：简单 YAML frontmatter + markdown body
 */
export type ParsedSkillMd = {
    name: string;
    /** 展示用中文/可读标题；可空，由 resolveSkillDisplayName 回退 */
    title: string;
    description: string;
    body: string;
    frontmatter: Record<string, unknown>;
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseSkillMarkdown(raw: string): ParsedSkillMd {
    const text = String(raw || "").replace(/^\uFEFF/, "");
    let frontmatter: Record<string, unknown> = {};
    let body = text;

    if (text.startsWith("---")) {
        const end = text.indexOf("\n---", 3);
        if (end >= 0) {
            const fmBlock = text.slice(3, end).trim();
            body = text.slice(end + 4).replace(/^\r?\n/, "");
            frontmatter = parseSimpleYaml(fmBlock);
        }
    }

    const nameRaw = String(frontmatter.name || "").trim().toLowerCase();
    const description = String(frontmatter.description || "").trim();
    const title = String(frontmatter.title || frontmatter.display_name || "").trim();

    if (!nameRaw || !NAME_RE.test(nameRaw)) {
        throw new Error("SKILL.md 缺少合法 name（小写字母/数字/连字符，最长 64）");
    }
    if (!description) {
        throw new Error("SKILL.md 缺少 description");
    }
    if (description.length > 1024) {
        throw new Error("description 过长（最多 1024 字符）");
    }
    if (title.length > 64) {
        throw new Error("title 过长（最多 64 字符）");
    }

    return { name: nameRaw, title, description, body: body.trim(), frontmatter };
}

/** 下拉/列表用展示名：title > 正文一级标题 > description 首句 > name */
export function resolveSkillDisplayName(input: {
    name: string;
    description?: string | null;
    body_md?: string | null;
    frontmatter_json?: Record<string, unknown> | null;
}): string {
    const fm = input.frontmatter_json || {};
    const fromFm = String(fm.title || fm.display_name || "").trim();
    if (fromFm) return fromFm.slice(0, 64);

    const body = String(input.body_md || "");
    const h1 = body.match(/^#\s+(.+?)\s*$/m);
    if (h1?.[1]) return h1[1].trim().slice(0, 64);

    const desc = String(input.description || "").trim();
    if (desc) {
        const first = desc.split(/[\n。；;]/)[0]?.trim() || "";
        if (first) return first.slice(0, 40);
    }
    return input.name;
}

function stripQuotes(v: string): string {
    const s = v.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

function parseSimpleYaml(block: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let buf: string[] = [];

    const flush = () => {
        if (!currentKey) return;
        out[currentKey] = buf.join(" ").trim();
        currentKey = null;
        buf = [];
    };

    for (const line of block.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (m && !/^\s/.test(line)) {
            flush();
            const key = m[1]!;
            const rest = (m[2] ?? "").trim();
            if (rest === ">" || rest === "|" || rest === "") {
                currentKey = key;
                buf = [];
                continue;
            }
            out[key] = stripQuotes(rest);
            continue;
        }
        if (currentKey && /^\s+/.test(line)) {
            buf.push(line.trim());
        }
    }
    flush();
    return out;
}

export function detectHasScripts(paths: string[]): boolean {
    return paths.some((p) => {
        const n = p.replace(/\\/g, "/").toLowerCase();
        return n.includes("/scripts/") || n.startsWith("scripts/") || /(^|\/)scripts(\/|$)/.test(n);
    });
}

/** 仅可执行脚本才标 unsupported；市场包里的 scripts/*.js GUI 不阻塞 Agent 使用 */
export function detectExecutableScripts(paths: string[]): boolean {
    return paths.some((p) => {
        const n = p.replace(/\\/g, "/").toLowerCase();
        if (!(n.includes("/scripts/") || n.startsWith("scripts/"))) return false;
        return /\.(py|sh|bash|zsh|rb|php|pl|exe|bat|ps1|cmd)$/i.test(n);
    });
}
