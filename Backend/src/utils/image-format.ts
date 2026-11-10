export type DetectedImageFormat = {
    ext: string; // e.g. ".jpg"
    mime: string; // e.g. "image/jpeg"
    source: "content-type" | "magic" | "url-ext" | "fallback";
};

const MIME_TO_EXT: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const EXT_TO_MIME: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
};

function normalizeContentType(v?: string): string | undefined {
    if (!v) return undefined;
    const raw = String(v).trim().toLowerCase();
    if (!raw) return undefined;
    // drop charset or other parameters: "image/jpeg; charset=binary"
    return raw.split(";")[0]?.trim() || undefined;
}

function detectFromMagicBytes(buf: Buffer): { mime: string; ext: string } | undefined {
    if (!buf || buf.length < 12) return undefined;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
    ) {
        return { mime: "image/png", ext: ".png" };
    }

    // JPEG: FF D8 FF
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return { mime: "image/jpeg", ext: ".jpg" };
    }

    // GIF: "GIF87a" / "GIF89a"
    if (
        buf.length >= 6 &&
        buf[0] === 0x47 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x38 &&
        (buf[4] === 0x37 || buf[4] === 0x39) &&
        buf[5] === 0x61
    ) {
        return { mime: "image/gif", ext: ".gif" };
    }

    // WEBP: "RIFF" .... "WEBP"
    if (
        buf.length >= 12 &&
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
    ) {
        return { mime: "image/webp", ext: ".webp" };
    }

    return undefined;
}

function detectFromUrlExt(urlPathname?: string): { mime: string; ext: string } | undefined {
    if (!urlPathname) return undefined;
    const p = (String(urlPathname).split("?")[0] ?? "").split("#")[0] ?? "";
    if (!p) return undefined;
    const dot = p.lastIndexOf(".");
    if (dot < 0) return undefined;
    const ext = p.slice(dot).toLowerCase();
    const mime = EXT_TO_MIME[ext];
    if (!mime) return undefined;
    // Normalize jpg/jpeg to .jpg for naming consistency
    const normalizedExt = ext === ".jpeg" ? ".jpg" : ext;
    return { mime, ext: normalizedExt };
}

export function detectImageFormat(params: {
    contentTypeHeader?: string;
    urlPathname?: string;
    firstBytes: Buffer;
}): DetectedImageFormat {
    const ct = normalizeContentType(params.contentTypeHeader);
    if (ct && MIME_TO_EXT[ct]) {
        return { mime: ct, ext: MIME_TO_EXT[ct]!, source: "content-type" };
    }

    const byMagic = detectFromMagicBytes(params.firstBytes);
    if (byMagic) {
        return { ...byMagic, source: "magic" };
    }

    const byUrl = detectFromUrlExt(params.urlPathname);
    if (byUrl) {
        return { ...byUrl, source: "url-ext" };
    }

    return { mime: "application/octet-stream", ext: ".bin", source: "fallback" };
}

/**
 * GPT Image 2.6 原生 GIF 动图参数（上游文档规则，仅 2.6 flare / sunburst 可用）。
 * - size 省略 / 为 auto 时使用 512x512 预设；也可显式传其它 WIDTHxHEIGHT（如 1024x1024）
 * - GIF 有独立的尺寸与帧数限制，不能套用静态 4K 规格；尺寸、帧数、数量共同受像素预算约束
 *   文档已验证「普通 Flare 1024x1024 + 2 帧」，但未验证所有 1K 组合或 4K GIF
 * - 跳过静态图的 655360 像素下限（512x512 = 262144 必须放行），仍保留静态侧上限作为护栏
 * - frame_count：2–16 的整数，未指定默认 9
 * - frame_duration_ms：20–655350 的整数，按最接近的 10ms 取整，未指定默认 200
 * - n 表示返回的 GIF 文件数，不是动画帧数
 */
export const GPT26_GIF = {
    DEFAULT_SIZE: "512x512",
    MAX_SIDE: 3840,          // 沿用静态侧最大边（4K 预设 3840x2160）
    MAX_PIXELS: 8_294_400,   // 沿用静态侧像素上限；文档明确 4096x4096 已超限
    MIN_SIDE: 64,
    MIN_FRAMES: 2,
    MAX_FRAMES: 16,
    DEFAULT_FRAMES: 9,
    MIN_FRAME_DURATION_MS: 20,
    MAX_FRAME_DURATION_MS: 655350,
    DEFAULT_FRAME_DURATION_MS: 200,
} as const;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeGpt26FrameCount(raw?: unknown): number {
    return clampInt(raw, GPT26_GIF.MIN_FRAMES, GPT26_GIF.MAX_FRAMES, GPT26_GIF.DEFAULT_FRAMES);
}

export function normalizeGpt26FrameDurationMs(raw?: unknown): number {
    const ms = clampInt(raw, GPT26_GIF.MIN_FRAME_DURATION_MS, GPT26_GIF.MAX_FRAME_DURATION_MS, GPT26_GIF.DEFAULT_FRAME_DURATION_MS);
    return Math.round(ms / 10) * 10;
}

/**
 * GIF 尺寸：省略 / auto / 非法 / 超预算 → 使用 512x512 预设；
 * 合法的 WIDTHxHEIGHT 原样透传（不做静态图 655360 像素下限校验）。
 * 上游未给出 GIF 的精确像素预算公式，这里只做保守护栏，真正的组合是否可用由上游决定。
 */
export function normalizeGpt26GifSize(raw?: unknown): string {
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!s || s === "auto") return GPT26_GIF.DEFAULT_SIZE;
    const m = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(s);
    if (!m) return GPT26_GIF.DEFAULT_SIZE;
    const width = Number(m[1]);
    const height = Number(m[2]);
    const ratio = Math.max(width / height, height / width);
    if (width < GPT26_GIF.MIN_SIDE || height < GPT26_GIF.MIN_SIDE
        || width > GPT26_GIF.MAX_SIDE || height > GPT26_GIF.MAX_SIDE
        || ratio > 3 || width * height > GPT26_GIF.MAX_PIXELS) {
        console.warn("[GPT26_GIF] size 超出保守护栏，回退 512x512 预设", { raw, width, height });
        return GPT26_GIF.DEFAULT_SIZE;
    }
    return `${width}x${height}`;
}

/** GIF 专用请求字段（含尺寸），静态图不要调用 */
export function buildGpt26GifParams(params: { size?: unknown; frameCount?: unknown; frameDurationMs?: unknown }): {
    size: string;
    frame_count: number;
    frame_duration_ms: number;
} {
    return {
        size: normalizeGpt26GifSize(params.size),
        frame_count: normalizeGpt26FrameCount(params.frameCount),
        frame_duration_ms: normalizeGpt26FrameDurationMs(params.frameDurationMs),
    };
}

