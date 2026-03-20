/** 与 Sidebar 等一致：兼容 userInfo.role / userInfo.role_id */
export function getUserRoleFromInfo(info: unknown): number | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const o = info as Record<string, unknown>;
  const raw = o.role ?? o.role_id;
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
