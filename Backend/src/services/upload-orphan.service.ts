import fs from "fs";
import path from "path";
import COS from "cos-nodejs-sdk-v5";
import { AppDataSource } from "../data-source";
import { isCosEnabled, deleteObject as cosDeleteObject, pathToKey } from "./cos.service";
import {
    collectUploadFilenamesFromText,
    collectUploadFilenamesFromWorkflow,
    mergeUploadFilenames,
} from "../utils/upload-filenames";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
/** 未被引用且超过该天数的文件才删除，避免刚上传尚未写入 DB 时被误删 */
const ORPHAN_GRACE_DAYS = Number(process.env.UPLOAD_ORPHAN_GRACE_DAYS || "7");

function cosClientFromEnv(): COS | null {
    const secretId = process.env.COS_SECRET_ID || "";
    const secretKey = process.env.COS_SECRET_KEY || "";
    if (!secretId || !secretKey) return null;
    return new COS({ SecretId: secretId, SecretKey: secretKey });
}

/**
 * 从数据库收集仍被引用的 uploads/ 根目录文件名
 */
export async function collectReferencedUploadFilenames(): Promise<Set<string>> {
    const groups: string[][] = [];

    const templates = await AppDataSource.query(
        `SELECT workflow_data, cover_image FROM workflow_template`
    ) as Array<{ workflow_data: string; cover_image?: string | null }>;
    for (const row of templates) {
        let data: unknown = null;
        try {
            data = JSON.parse(row.workflow_data);
        } catch {
            // ignore
        }
        groups.push(collectUploadFilenamesFromWorkflow(data, row.cover_image));
    }

    const histories = await AppDataSource.query(
        `SELECT workflow_data FROM workflow_history`
    ) as Array<{ workflow_data: string }>;
    for (const row of histories) {
        try {
            groups.push(collectUploadFilenamesFromWorkflow(JSON.parse(row.workflow_data)));
        } catch {
            // ignore
        }
    }

    const imageRows = await AppDataSource.query(
        `SELECT image_url, all_images FROM image_result`
    ) as Array<{ image_url?: string; all_images?: string }>;
    for (const row of imageRows) {
        groups.push(collectUploadFilenamesFromText(row.image_url));
        groups.push(collectUploadFilenamesFromText(row.all_images));
    }

    const videoRows = await AppDataSource.query(
        `SELECT video_urls FROM video_task WHERE video_urls IS NOT NULL`
    ) as Array<{ video_urls?: string | string[] }>;
    for (const row of videoRows) {
        const raw = row.video_urls;
        if (typeof raw === "string") {
            groups.push(collectUploadFilenamesFromText(raw));
        } else if (Array.isArray(raw)) {
            for (const u of raw) groups.push(collectUploadFilenamesFromText(u));
        }
    }

    return mergeUploadFilenames(...groups);
}

function isOlderThanGrace(filePath: string): boolean {
    try {
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtimeMs;
        return ageMs >= ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000;
    } catch {
        return false;
    }
}


async function deleteCosUploadFile(filename: string): Promise<void> {
    if (!isCosEnabled()) return;
    await cosDeleteObject(pathToKey(`/uploads/${filename}`));
}

/**
 * 清理本地 uploads/ 根目录下未被引用的孤儿文件（不递归 chat-temp）
 */
export async function cleanupLocalOrphanUploads(referenced: Set<string>): Promise<number> {
    if (!fs.existsSync(UPLOADS_DIR)) return 0;
    let deleted = 0;
    const entries = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true });
    for (const ent of entries) {
        if (!ent.isFile()) continue;
        const name = ent.name;
        if (referenced.has(name)) continue;
        const filePath = path.join(UPLOADS_DIR, name);
        if (!isOlderThanGrace(filePath)) continue;
        try {
            fs.unlinkSync(filePath);
            deleted += 1;
        } catch (e) {
            console.warn("[upload-orphan] local unlink failed:", name, e);
        }
    }
    return deleted;
}

/**
 * 清理 COS uploads/ 前缀下未被引用的对象（仅顶层文件 key：uploads/filename.ext）
 */
export async function cleanupCosOrphanUploads(referenced: Set<string>): Promise<number> {
    if (!isCosEnabled()) return 0;
    const bucket = process.env.COS_BUCKET || "";
    const region = process.env.COS_REGION || "ap-beijing";
    const cos = cosClientFromEnv();
    if (!cos || !bucket) return 0;

    let deleted = 0;
    let marker: string | undefined;

        for (;;) {
            const data = await new Promise<COS.GetBucketResult>((resolve, reject) => {
                cos.getBucket(
                    {
                        Bucket: bucket,
                        Region: region,
                        Prefix: "uploads/",
                        Delimiter: "/",
                        MaxKeys: 1000,
                        ...(marker ? { Marker: marker } : {}),
                    },
                    (err, result) => (err ? reject(err) : resolve(result))
                );
            });

            const contents = data.Contents ?? [];
            for (const obj of contents) {
                const key = obj.Key;
                if (!key || key === "uploads/" || key.includes("/chat-temp/")) continue;
                const rest = key.slice("uploads/".length);
                if (rest.includes("/")) continue;
                if (referenced.has(rest)) continue;
                if (obj.LastModified) {
                    const ageMs = Date.now() - new Date(obj.LastModified).getTime();
                    if (ageMs < ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000) continue;
                }
                try {
                    await deleteCosUploadFile(rest);
                    deleted += 1;
                } catch (e) {
                    console.warn("[upload-orphan] COS delete failed:", key, e);
                }
            }

            const truncated = String(data.IsTruncated) === "true";
            if (!truncated) break;
            marker = data.NextMarker;
            if (!marker) break;
        }

    return deleted;
}

export class UploadOrphanService {
    async cleanupOrphanUploads(): Promise<{ localDeleted: number; cosDeleted: number }> {
        const referenced = await collectReferencedUploadFilenames();
        const localDeleted = await cleanupLocalOrphanUploads(referenced);
        const cosDeleted = await cleanupCosOrphanUploads(referenced);
        return { localDeleted, cosDeleted };
    }
}
