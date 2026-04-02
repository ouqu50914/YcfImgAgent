export function formatIsoToYmdHms(value: unknown): string {
  if (value == null) return '';

  // Element Plus table formatter 可能传入的是 cellValue（字符串/时间戳/Date）
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);

  // 统一按北京时间（Asia/Shanghai）输出，避免客户端时区不同导致显示不一致
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const yyyy = pick('year');
  const mm = pick('month');
  const dd = pick('day');
  const hh = pick('hour');
  const min = pick('minute');
  const ss = pick('second');

  // zh-CN 的 month/day/hour/minute/second 已是 2 位，不再额外 pad
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

