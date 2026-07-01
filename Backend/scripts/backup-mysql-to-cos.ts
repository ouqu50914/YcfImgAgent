#!/usr/bin/env ts-node
/**
 * MySQL 全量备份并上传到腾讯云 COS
 *
 * 环境变量（从项目根目录 .env 读取，也可直接 export）：
 *   MYSQL_ROOT_PASSWORD   必填
 *   MYSQL_DATABASE        默认 ai_image_tool
 *   MYSQL_CONTAINER       默认 ycf_mysql
 *   LOCAL_BACKUP_DIR      默认 /backup/mysql（不存在则回退到项目 backups/mysql）
 *   COS_DB_BACKUP_PREFIX  默认 db-backup
 *   LOCAL_RETAIN_DAYS     默认 7
 *   COS_RETAIN_DAYS       默认 30
 *   USE_COS / COS_*       与后端相同
 *
 * 用法：
 *   cd Backend && yarn backup-mysql-to-cos
 *   或项目根目录：./scripts/backup-mysql-to-cos.sh
 *
 * 恢复示例：
 *   coscmd download db-backup/ai_image_tool-2026-06-30-030001.sql.gz /tmp/r.sql.gz
 *   gunzip -c /tmp/r.sql.gz | docker exec -i ycf_mysql mysql -uroot -p'...' ai_image_tool
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import zlib from "zlib";
import COS from "cos-nodejs-sdk-v5";

const projectRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const MYSQL_ROOT_PASSWORD = process.env.MYSQL_ROOT_PASSWORD || "";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "ai_image_tool";
const MYSQL_CONTAINER = process.env.MYSQL_CONTAINER || "ycf_mysql";
const COS_PREFIX = (process.env.COS_DB_BACKUP_PREFIX || "db-backup").replace(/\/+$/, "");
const LOCAL_RETAIN_DAYS = Number(process.env.LOCAL_RETAIN_DAYS || "7");
const COS_RETAIN_DAYS = Number(process.env.COS_RETAIN_DAYS || "30");

const USE_COS = process.env.USE_COS === "true";
const COS_BUCKET = process.env.COS_BUCKET || "";
const COS_REGION = process.env.COS_REGION || "ap-beijing";
const COS_SECRET_ID = process.env.COS_SECRET_ID || "";
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || "";

function resolveLocalBackupDir(): string {
    const preferred = process.env.LOCAL_BACKUP_DIR || "/backup/mysql";
    if (fs.existsSync(path.dirname(preferred)) || preferred.startsWith("/backup")) {
        try {
            fs.mkdirSync(preferred, { recursive: true });
            return preferred;
        } catch {
            // fall through
        }
    }
    const fallback = path.join(projectRoot, "backups", "mysql");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
}

function timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runMysqldumpToGzip(outFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const docker = spawn(
            "docker",
            [
                "exec",
                MYSQL_CONTAINER,
                "mysqldump",
                "-uroot",
                `-p${MYSQL_ROOT_PASSWORD}`,
                "--single-transaction",
                "--routines",
                "--triggers",
                "--set-gtid-purged=OFF",
                MYSQL_DATABASE,
            ],
            { stdio: ["ignore", "pipe", "pipe"] }
        );

        const gzip = zlib.createGzip({ level: 6 });
        const out = fs.createWriteStream(outFile);
        let stderr = "";
        let exitCode: number | null = null;

        docker.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            if (!text.includes("Using a password on the command line interface can be insecure")) {
                process.stderr.write(text);
            }
        });

        docker.stdout.pipe(gzip).pipe(out);

        docker.on("error", reject);
        out.on("error", reject);
        gzip.on("error", reject);

        docker.on("close", (code) => {
            exitCode = code;
        });

        out.on("finish", () => {
            if (exitCode === 0) resolve();
            else reject(new Error(`mysqldump 失败 (${exitCode}): ${stderr}`));
        });
    });
}

function getCosClient(): COS {
    if (!USE_COS || !COS_SECRET_ID || !COS_SECRET_KEY || !COS_BUCKET) {
        throw new Error("COS 未配置：请设置 USE_COS=true 及 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET");
    }
    return new COS({ SecretId: COS_SECRET_ID, SecretKey: COS_SECRET_KEY });
}

async function uploadToCos(localPath: string, key: string): Promise<void> {
    const cos = getCosClient();
    const body = fs.readFileSync(localPath);
    await new Promise<void>((resolve, reject) => {
        cos.putObject(
            {
                Bucket: COS_BUCKET,
                Region: COS_REGION,
                Key: key,
                Body: body,
                ContentType: "application/gzip",
            },
            (err) => (err ? reject(err) : resolve())
        );
    });
}

async function deleteCosKey(key: string): Promise<void> {
    const cos = getCosClient();
    await new Promise<void>((resolve, reject) => {
        cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) =>
            err ? reject(err) : resolve()
        );
    });
}

async function cleanupOldCosBackups(dbName: string): Promise<number> {
    if (COS_RETAIN_DAYS <= 0) return 0;
    const cos = getCosClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - COS_RETAIN_DAYS);
    const nameRe = new RegExp(`^${COS_PREFIX}/${dbName}-(\\d{4}-\\d{2}-\\d{2})-\\d{6}\\.sql\\.gz$`);

    let deleted = 0;
    let marker: string | undefined;

    for (;;) {
        const data: COS.GetBucketResult = await new Promise((resolve, reject) => {
            cos.getBucket(
                {
                    Bucket: COS_BUCKET,
                    Region: COS_REGION,
                    Prefix: `${COS_PREFIX}/`,
                    MaxKeys: 1000,
                    ...(marker ? { Marker: marker } : {}),
                },
                (err, result) => (err ? reject(err) : resolve(result))
            );
        });

        for (const obj of data.Contents ?? []) {
            const key = obj.Key;
            if (!key) continue;
            const m = key.match(nameRe);
            if (!m) continue;
            const fileDate = new Date(`${m[1]}T00:00:00`);
            if (fileDate >= cutoff) continue;
            try {
                await deleteCosKey(key);
                deleted += 1;
                console.log(`[cleanup] 已删除 COS 过期备份: ${key}`);
            } catch (e) {
                console.warn(`[cleanup] 删除失败 ${key}:`, e);
            }
        }

        const truncated = String(data.IsTruncated) === "true";
        if (!truncated) break;
        marker = data.NextMarker;
        if (!marker) break;
    }

    return deleted;
}

function cleanupLocalBackups(dir: string, dbName: string): number {
    if (LOCAL_RETAIN_DAYS <= 0) return 0;
    let deleted = 0;
    const cutoffMs = Date.now() - LOCAL_RETAIN_DAYS * 24 * 60 * 60 * 1000;
    const prefix = `${dbName}-`;
    for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(prefix) || !name.endsWith(".sql.gz")) continue;
        const fp = path.join(dir, name);
        try {
            const stat = fs.statSync(fp);
            if (stat.mtimeMs < cutoffMs) {
                fs.unlinkSync(fp);
                deleted += 1;
            }
        } catch {
            // ignore
        }
    }
    return deleted;
}

async function main(): Promise<void> {
    if (!MYSQL_ROOT_PASSWORD) {
        console.error("[ERROR] 请设置 MYSQL_ROOT_PASSWORD（与 docker-compose.prod.yml 一致）");
        process.exit(1);
    }

    const localDir = resolveLocalBackupDir();
    const ts = timestamp();
    const filename = `${MYSQL_DATABASE}-${ts}.sql.gz`;
    const localPath = path.join(localDir, filename);
    const cosKey = `${COS_PREFIX}/${filename}`;

    console.log(`[INFO] ${new Date().toISOString()} 开始备份 ${MYSQL_DATABASE} → ${localPath}`);

    await runMysqldumpToGzip(localPath);
    const sizeMb = (fs.statSync(localPath).size / 1024 / 1024).toFixed(2);
    console.log(`[INFO] mysqldump 完成，大小 ${sizeMb} MB`);

    console.log(`[INFO] 上传到 COS: ${cosKey}`);
    await uploadToCos(localPath, cosKey);
    console.log(`[INFO] COS 上传完成`);

    const localCleaned = cleanupLocalBackups(localDir, MYSQL_DATABASE);
    const cosCleaned = await cleanupOldCosBackups(MYSQL_DATABASE);

    console.log(
        `[INFO] 备份成功。本地: ${localPath} | COS: ${cosKey} | 清理本地 ${localCleaned} 个，COS ${cosCleaned} 个`
    );
}

main().catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
});
