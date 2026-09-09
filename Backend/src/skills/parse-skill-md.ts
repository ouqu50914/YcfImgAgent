/**
 * 解析 SKILL.md：简单 YAML frontmatter + markdown body
 */
export type ParsedSkillMd = {
    name: string;
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

    if (!nameRaw || !NAME_RE.test(nameRaw)) {
        throw new Error("SKILL.md 缺少合法 name（小写字母/数字/连字符，最长 64）");
    }
    if (!description) {
        throw new Error("SKILL.md 缺少 description");
    }
    if (description.length > 1024) {
        throw new Error("description 过长（最多 1024 字符）");
    }

    return { name: nameRaw, description, body: body.trim(), frontmatter };
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
