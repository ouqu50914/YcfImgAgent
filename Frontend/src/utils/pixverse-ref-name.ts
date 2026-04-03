/**
 * PixVerse fusion：image_references.ref_name 需与 prompt 中 @别名 一致。
 * 上游对 ref_name 校验较严（Err 400017）；需「字母开头 + 仅字母数字」，与文档示例 dog/room 一致。
 * 勿使用 r_1、下划线等易被拒的格式。
 */
export function sanitizePixverseRefName(raw: string | undefined, indexZeroBased: number): string {
  const fallback = `ref${indexZeroBased + 1}`;
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  let slug = s.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (!slug) return fallback;
  if (!/^[a-zA-Z]/.test(slug)) {
    return fallback;
  }
  return slug.slice(0, 64);
}

/** 同一 fusion 请求内 ref_name 必须唯一 */
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

/** 从画布别名「图1」「图2」解析序号，供 fusion 将 @图4 映射到对应 ref（非连接顺序） */
export function parseImageFigureNumberFromAlias(alias: string | undefined): number | null {
  const m = String(alias ?? '')
    .trim()
    .match(/^图(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}
