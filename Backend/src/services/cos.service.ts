/**
 * 腾讯云 COS 存储服务
 * 用于上传文件与生成私有读预签名 URL；启用 COS 时可不落盘，通过 getFileContent 从 COS 读取
 */
import COS from "cos-nodejs-sdk-v5";
import fs from "fs";
import path from "path";

const USE_COS = process.env.USE_COS === "true";
const BUCKET = process.env.COS_BUCKET || "";
const REGION = process.env.COS_REGION || "ap-beijing";
const SECRET_ID = process.env.COS_SECRET_ID || "";
const SECRET_KEY = process.env.COS_SECRET_KEY || "";
/** 自定义访问域名，如 artycf.com，生成预签名 URL 时将使用该域名 */
const DOMAIN = process.env.COS_DOMAIN || "";

let cosClient: COS | null = null;

function getClient(): COS | null {
    if (!USE_COS || !SECRET_ID || !SECRET_KEY || !BUCKET) return null;
    if (!cosClient) {
        cosClient = new COS({
            SecretId: SECRET_ID,
            SecretKey: SECRET_KEY,
        });
    }
    return cosClient;
}

/**
 * 是否启用 COS（配置完整且 USE_COS=true）
 */
export function isCosEnabled(): boolean {
    return !!(USE_COS && SECRET_ID && SECRET_KEY && BUCKET);
}

/**
 * 将逻辑路径 /uploads/xxx 转为 COS Key（uploads/xxx，无前导斜杠）
 */
export function pathToKey(urlPath: string): string {
    const normalized = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
    return normalized || "";
}

/**
 * 上传到 COS
 * @param key COS 对象键，如 uploads/upload_xxx.jpg
 * @param content Buffer、本地文件路径或 NodeJS.ReadableStream
 * @param contentType 可选，如 image/png
 */
export function upload(
    key: string,
    content: Buffer | string | NodeJS.ReadableStream,
    contentType?: string
): Promise<void> {
    const client = getClient();
    if (!client) return Promise.reject(new Error("COS 未配置或未启用"));

    let body: Buffer | NodeJS.ReadableStream;
    let contentLength: number | undefined;
    const headers: Record<string, string> = contentType ? { "Content-Type": contentType } : {};

    if (typeof content === "string" && fs.existsSync(content)) {
        body = fs.readFileSync(content);
        contentLength = body.length;
    } else if (Buffer.isBuffer(content)) {
        body = content;
        contentLength = content.length;
    } else {
        body = content as NodeJS.ReadableStream;
    }

    return new Promise((resolve, reject) => {
        const params: Record<string, unknown> = {
            Bucket: BUCKET,
            Region: REGION,
            Key: key,
            Body: body,
            Headers: headers,
        };
        if (contentLength !== undefined) params.ContentLength = contentLength;
        client.putObject(params as any, (err: unknown) => (err ? reject(err) : resolve()));
    });
}

/**
 * 生成预签名 URL（用于私有读）
 * @param key COS 对象键，如 uploads/foo.png
 * @param expiresInSeconds 有效期（秒），默认 3600
 */
export function getSignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    const client = getClient();
    if (!client) return Promise.reject(new Error("COS 未配置或未启用"));

    return new Promise((resolve, reject) => {
        const options: Record<string, unknown> = {
            Bucket: BUCKET,
            Region: REGION,
            Key: key,
            Sign: true,
            Expires: expiresInSeconds,
        };
        if (DOMAIN) options.Domain = DOMAIN;
        client.getObjectUrl(options as any, (err: unknown, data: { Url?: string }) => {
            if (err) return reject(err);
            resolve(data?.Url || "");
        });
    });
}

/**
 * 从 COS 获取对象内容（Buffer）
 */
export function getObject(key: string): Promise<Buffer> {
    const client = getClient();
    if (!client) return Promise.reject(new Error("COS 未配置或未启用"));
    return new Promise((resolve, reject) => {
        client.getObject(
            { Bucket: BUCKET, Region: REGION, Key: key },
            (err: unknown, data: { Body?: Buffer }) => {
                if (err) return reject(err);
                if (!data?.Body) return reject(new Error("COS getObject 无内容"));
                resolve(data.Body);
            }
        );
    });
}

/**
 * 从 COS 删除对象（用于删除模板/历史时同步清理云端文件）
 * @param key COS 对象键，如 uploads/upload_xxx.jpg
 */
export function deleteObject(key: string): Promise<void> {
    const client = getClient();
    if (!client) return Promise.reject(new Error("COS 未配置或未启用"));
    return new Promise((resolve, reject) => {
        client.deleteObject(
            { Bucket: BUCKET, Region: REGION, Key: key },
            (err: unknown) => (err ? reject(err) : resolve())
        );
    });
}

/**
 * 根据逻辑路径获取文件内容：启用 COS 时从 COS 读，否则从本地 uploads 读
 * @param urlPath 如 /uploads/upload_xxx.jpg
 */
export async function getFileContent(urlPath: string): Promise<Buffer> {
    if (!urlPath || !urlPath.includes("/uploads/")) {
        throw new Error("getFileContent 仅支持 /uploads/ 路径");
    }
    const key = pathToKey(urlPath.startsWith("/") ? urlPath : `/${urlPath}`);
    if (isCosEnabled()) {
        return getObject(key);
    }
    const localPath = path.join(process.cwd(), urlPath.startsWith("/") ? urlPath.slice(1) : urlPath);
    return fs.promises.readFile(localPath);
}
