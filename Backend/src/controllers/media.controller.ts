import type { Request, Response } from "express";
import { fetch } from "undici";
import { parseBuffer } from "music-metadata";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import net from "node:net";

type MediaKind = "video" | "audio";

function isPrivateIp(ip: string): boolean {
    if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip === "::1") return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("169.254.")) return true;
    // 172.16.0.0/12
    const m = ip.match(/^172\.(\d+)\./);
    if (m) {
        const n = Number(m[1]);
        if (n >= 16 && n <= 31) return true;
    }
    // IPv6 fc00::/7, fe80::/10
    const lower = ip.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    return false;
}

async function assertSafeHttpUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("url 非法");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("仅支持 http/https 外链");
    }
    if (!url.hostname) {
        throw new Error("url hostname 非法");
    }
    const host = url.hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
        throw new Error("不允许探测本地域名");
    }
    const ipType = net.isIP(host);
    if (ipType) {
        if (isPrivateIp(host)) throw new Error("不允许探测内网地址");
        return url;
    }
    const resolved = await lookup(host, { family: 0, all: true, verbatim: true });
    for (const r of resolved) {
        if (isPrivateIp(r.address)) {
            throw new Error("不允许探测内网地址");
        }
    }
    return url;
}

function getLimits(kind: MediaKind) {
    // 来自 Seedance 文档：
    // - 参考视频：单个 <= 50MB；时长 [2,15]s；总时长 <= 15s
    // - 参考音频：单个 <= 15MB；时长 [2,15]s；总时长 <= 15s
    return kind === "video"
        ? { maxBytes: 50 * 1024 * 1024, kindLabel: "视频" }
        : { maxBytes: 15 * 1024 * 1024, kindLabel: "音频" };
}

async function fetchWithSizeCap(url: string, maxBytes: number): Promise<{ buf: Buffer; mimeType?: string; sizeBytes?: number }> {
    const headRes = await fetch(url, { method: "HEAD" }).catch(() => null as any);
    const mimeType = headRes?.headers?.get?.("content-type") || undefined;
    const lenHeader = headRes?.headers?.get?.("content-length");
    const sizeBytes = lenHeader ? Number(lenHeader) : undefined;
    if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > maxBytes) {
        throw new Error(`文件过大（>${maxBytes} bytes）`);
    }

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
        throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") || mimeType;
    const cl = res.headers.get("content-length");
    const reportedLen = cl ? Number(cl) : sizeBytes;
    if (typeof reportedLen === "number" && Number.isFinite(reportedLen) && reportedLen > maxBytes) {
        throw new Error(`文件过大（>${maxBytes} bytes）`);
    }

    if (!res.body) {
        const ab = await res.arrayBuffer();
        const b = Buffer.from(ab);
        if (b.length > maxBytes) throw new Error(`文件过大（>${maxBytes} bytes）`);
        return { buf: b, mimeType: ct || undefined, sizeBytes: b.length };
    }

    const stream = Readable.fromWeb(res.body as any);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += b.length;
        if (total > maxBytes) {
            try {
                stream.destroy();
            } catch {}
            throw new Error(`文件过大（>${maxBytes} bytes）`);
        }
        chunks.push(b);
    }
    const buf = Buffer.concat(chunks, total);
    return { buf, mimeType: ct || undefined, sizeBytes: total };
}

function isAllowedFormat(kind: MediaKind, mimeType: string | undefined, container: string | undefined): boolean {
    const mt = (mimeType || "").toLowerCase();
    const c = (container || "").toLowerCase();
    if (kind === "video") {
        // 文档：mp4、mov
        if (mt.includes("video/mp4")) return true;
        if (mt.includes("video/quicktime")) return true;
        if (c === "mpeg-4" || c === "mp4") return true;
        if (c === "quicktime" || c === "mov") return true;
        return false;
    }
    // audio: mp3、wav
    if (mt.includes("audio/mpeg")) return true;
    if (mt.includes("audio/mp3")) return true;
    if (mt.includes("audio/wav") || mt.includes("audio/wave") || mt.includes("audio/x-wav")) return true;
    if (c === "wav") return true;
    if (c === "mpeg" || c === "mp3") return true;
    return false;
}

export const probeMedia = async (req: Request, res: Response) => {
    try {
        const { url, kind } = (req.body || {}) as { url?: string; kind?: MediaKind };
        if (!url || typeof url !== "string") {
            return res.status(400).json({ message: "url 为必填项" });
        }
        const k: MediaKind = kind === "audio" ? "audio" : "video";

        const safe = await assertSafeHttpUrl(url);
        const { maxBytes, kindLabel } = getLimits(k);

        const { buf, mimeType, sizeBytes } = await fetchWithSizeCap(safe.toString(), maxBytes);
        const meta = await parseBuffer(buf, mimeType ? { mimeType } : undefined);
        const durationSeconds = Number(meta?.format?.duration);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return res.status(422).json({ message: `无法解析${kindLabel}时长` });
        }
        const container = typeof (meta as any)?.format?.container === "string" ? String((meta as any).format.container) : undefined;
        const finalMime = mimeType || undefined;
        if (!isAllowedFormat(k, finalMime, container)) {
            return res.status(422).json({ message: `${kindLabel}格式不符合要求（仅支持${k === "video" ? "mp4/mov" : "mp3/wav"}）` });
        }

        return res.status(200).json({
            message: "ok",
            data: {
                durationSeconds,
                sizeBytes: typeof sizeBytes === "number" ? sizeBytes : buf.length,
                mimeType: mimeType || null,
                container: container || null,
            },
        });
    } catch (e: any) {
        return res.status(400).json({
            message: e?.message || "探测失败",
        });
    }
};

