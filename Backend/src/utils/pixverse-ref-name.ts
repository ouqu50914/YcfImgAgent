/** PixVerse fusion：ref_name 字母开头 + 仅字母数字；与前端规则一致（避免 r_、下划线等 400017） */
export function sanitizePixverseRefName(raw: string | undefined, indexZeroBased: number): string {
    const fallback = `ref${indexZeroBased + 1}`;
    const s = String(raw ?? "").trim();
    if (!s) return fallback;
    let slug = s.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
    if (!slug) return fallback;
    if (!/^[a-zA-Z]/.test(slug)) {
        return fallback;
    }
    return slug.slice(0, 64);
}

export function allocPixverseRefName(raw: string | undefined, indexZeroBased: number, used: Set<string>): string {
    let base = sanitizePixverseRefName(raw, indexZeroBased);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
        candidate = `${base}${n++}`;
    }
    used.add(candidate);
    return candidate;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在已知 ref_name 后若紧接正文（非空白、非下一个 @），插入空格。
 * PixVerse 400017：@ref 后须有空格再接描述，例如 @dog plays。
 */
export function ensureSpaceAfterFusionRefs(prompt: string, refNames: string[]): string {
    let out = String(prompt ?? "");
    const sorted = [...new Set(refNames.filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const ref of sorted) {
        const re = new RegExp(`@${escapeRegExp(ref)}(?=[^\\s@])`, "g");
        out = out.replace(re, `@${ref} `);
    }
    return out;
}

/**
 * 将「@图1」「@图4」等映射为本次请求实际的 ref_name。
 * - 若提供 figureNumbers（与 refs 同序，表示每张图对应画布「图N」的 N），则 @图4 → 找到 N===4 的那张图的 ref。
 * - 否则按连接顺序：@图1 → refs[0]（旧行为）。
 * 再统一补空格，避免 @图1站立、@ref1跳舞 触发 400017。
 */
export function normalizeFusionPromptForPixverse(
    prompt: string,
    refNamesOrdered: string[],
    figureNumbers?: number[] | null
): string {
    let s = String(prompt ?? "").trim();
    const refs = refNamesOrdered.filter(Boolean);
    if (!refs.length) return ensureSpaceAfterFusionRefs(s, []);

    const useFigureMap =
        Array.isArray(figureNumbers) &&
        figureNumbers.length === refs.length &&
        figureNumbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 1);

    const mapFigureToRef = (n: number): string => {
        if (!Number.isFinite(n) || n < 1) return `@${refs[0]}`;
        if (useFigureMap) {
            const idx = figureNumbers!.findIndex((fn) => Number(fn) === n);
            if (idx >= 0) return `@${refs[idx]}`;
        }
        const idx = Math.min(Math.max(0, n - 1), refs.length - 1);
        return `@${refs[idx]}`;
    };

    const mapIndexToRef = (numStr: string) => {
        const n = parseInt(String(numStr), 10);
        return mapFigureToRef(n);
    };

    // 画布常见「图1」；上游/缓存里常见「t1」
    s = s.replace(/@图\s*(\d+)/g, (_m, numStr: string) => mapIndexToRef(numStr));
    s = s.replace(/@t\s*(\d+)/gi, (_m, numStr: string) => mapIndexToRef(numStr));

    return ensureSpaceAfterFusionRefs(s, refs);
}
