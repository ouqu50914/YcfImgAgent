export function formatIsoToYmdHms(value: unknown): string {
  if (value == null) return '';

  // Element Plus table formatter 可能传入的是 cellValue（字符串/时间戳/Date）
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);

  // 由于后端常返回带 `Z` 的 ISO 字符串（UTC），这里用 UTC 输出，避免“同一份数据在不同机器显示不一致”
  const pad = (n: number) => String(n).padStart(2, '0');

  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

