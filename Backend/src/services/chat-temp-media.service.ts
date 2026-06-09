import fs from "fs";
import os from "os";
import path from "path";
import {
    isCosEnabled,
    upload as cosUpload,
    pathToKey,
    getFileContent,
    deleteObject as cosDeleteObject,
} from "./cos.service";

export const CHAT_TEMP_SUBDIR = "chat-temp";
export const CHAT_TEMP_URL_PREFIX = `/uploads/${CHAT_TEMP_SUBDIR}/`;

export function getChatTempDir(): string {
    const dir = path.join(process.cwd(), "uploads", CHAT_TEMP_SUBDIR);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function isChatTempMediaUrl(url: string): boolean {
    return typeof url === "string" && url.includes(`/${CHAT_TEMP_SUBDIR}/`);
}

export function chatTempUrlFromFilename(filename: string): string {
    return `${CHAT_TEMP_URL_PREFIX}${filename}`;
}

function normalizeUploadUrl(url: string): string {
    return url.trim().startsWith("/") ? url.trim() : `/${url.trim()}`;
}

export function resolveChatTempLocalPath(urlOrPath: string): string | null {
    if (!isChatTempMediaUrl(urlOrPath)) return null;
    const name = urlOrPath.split("/").pop();
    if (!name || name.includes("..")) return null;
    return path.join(getChatTempDir(), name);
}

export async function deleteChatTempMediaUrl(url: string): Promise<void> {
    const local = resolveChatTempLocalPath(url);
    if (local && fs.existsSync(local)) {
        try {
            fs.unlinkSync(local);
        } catch {
            // ignore
        }
    }
    if (isCosEnabled()) {
        try {
            await cosDeleteObject(pathToKey(normalizeUploadUrl(url)));
        } catch (e) {
            console.warn("[deleteChatTempMediaUrl] COS delete failed:", url, e);
        }
    }
}

export async function deleteChatTempMediaUrls(urls: string[]): Promise<void> {
    for (const u of urls) {
        if (typeof u === "string" && u.trim()) {
            await deleteChatTempMediaUrl(u.trim());
        }
    }
}

/** 读取上传路径字节（COS 优先，本地兜底） */
export async function readLocalUploadBytes(url: string): Promise<Buffer> {
    const normalized = normalizeUploadUrl(url);
    if (!normalized.includes("/uploads/")) {
        throw new Error("readLocalUploadBytes 仅支持 /uploads/ 路径");
    }
    return getFileContent(normalized);
}

export interface ChatTempLocalFileHandle {
    path: string;
    cleanup: () => void;
}

/**
 * 为 ffmpeg 等需要本地路径的场景提供可读文件：本地存在则直接用，否则从 COS/远程下载到临时目录
 */
export async function ensureChatTempLocalPath(url: string): Promise<ChatTempLocalFileHandle | null> {
    if (!isChatTempMediaUrl(url)) return null;

    const local = resolveChatTempLocalPath(url);
    if (local && fs.existsSync(local)) {
        return { path: local, cleanup: () => {} };
    }

    try {
        const buf = await readLocalUploadBytes(url);
        const name = url.split("/").pop() || `chat_${Date.now()}`;
        const tmpPath = path.join(os.tmpdir(), `chat-temp-${name}`);
        await fs.promises.writeFile(tmpPath, buf);
        return {
            path: tmpPath,
            cleanup: () => {
                try {
                    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                } catch {
                    // ignore
                }
            },
        };
    } catch (e) {
        console.warn("[ensureChatTempLocalPath] failed:", url, e);
        return null;
    }
}

/** 上传聊天临时媒体到 COS（启用时）或仅保留本地 */
export async function persistChatTempMedia(
    filename: string,
    buffer?: Buffer
): Promise<string> {
    const fileUrl = chatTempUrlFromFilename(filename);
    if (isCosEnabled() && buffer) {
        const key = pathToKey(fileUrl);
        await cosUpload(key, buffer);
    }
    return fileUrl;
}
