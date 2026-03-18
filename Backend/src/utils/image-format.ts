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

