/**
 * 解析工作流项目 ID（前端可传 templateId 或 template_id）
 */
export function parseTemplateIdFromBody(body: unknown): number | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const v = b.templateId ?? b.template_id;
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}
