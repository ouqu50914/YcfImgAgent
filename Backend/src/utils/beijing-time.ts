type AnyRecord = Record<string, any>;

const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const NAIVE_DT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * MySQL DATETIME is timezone-naive. In many deployments it's written in UTC
 * (e.g. CURRENT_TIMESTAMP on a UTC server), but returned without timezone.
 *
 * mysql2/TypeORM may hydrate it into a JS Date using the host local timezone,
 * which makes the epoch "look" 8 hours earlier in Asia/Shanghai.
 *
 * To make UI consistent, we interpret the Date's *local components* as UTC,
 * then format that instant into Asia/Shanghai and append +08:00.
 */
export function formatDateToBeijingIso(date: Date): string {
  const asUtcInstant = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  );

  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(asUtcInstant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const yyyy = pick("year");
  const mm = pick("month");
  const dd = pick("day");
  const hh = pick("hour");
  const mi = pick("minute");
  const ss = pick("second");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`;
}

export function coerceStringToBeijingIso(value: string): string {
  const s = value.trim();
  if (!s) return value;

  // ISO string with Z => convert to +08:00
  if (ISO_Z_RE.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatDateToBeijingIso(d);
    return value;
  }

  // MySQL DATETIME-style string without timezone:
  // treat it as UTC time and convert to +08:00
  if (NAIVE_DT_RE.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
    const isoUtc = s.replace(" ", "T") + "Z";
    const d = new Date(isoUtc);
    if (!Number.isNaN(d.getTime())) return formatDateToBeijingIso(d);
    return value;
  }

  return value;
}

/**
 * Recursively convert Date objects and common datetime strings to Beijing ISO (+08:00).
 * Safe for plain JSON-like objects/arrays; guards against cycles.
 */
export function convertJsonTimesToBeijingIso(input: any, seen = new WeakSet<object>()): any {
  if (input == null) return input;

  if (input instanceof Date) {
    return formatDateToBeijingIso(input);
  }

  if (typeof input === "string") {
    return coerceStringToBeijingIso(input);
  }

  if (typeof input !== "object") return input;

  if (seen.has(input)) return input;
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((v) => convertJsonTimesToBeijingIso(v, seen));
  }

  const obj = input as AnyRecord;
  const out: AnyRecord = {};
  for (const k of Object.keys(obj)) {
    out[k] = convertJsonTimesToBeijingIso(obj[k], seen);
  }
  return out;
}

