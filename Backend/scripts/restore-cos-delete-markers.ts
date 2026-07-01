/**
 * 批量删除 COS 指定时间范围内的 DeleteMarker（删除标记），恢复 uploads/ 下被「软删」的对象。
 *
 * 使用（在 Backend 目录，读取 .env 中的 COS_*）：
 *   DRY_RUN=1 yarn restore-cos-markers              # 只统计，不删除
 *   yarn restore-cos-markers                        # 正式执行
 *
 * 可选环境变量：
 *   RESTORE_START  起始时间（含），默认 2026-06-26T00:00:00+08:00
 *   RESTORE_END    结束时间（含），默认脚本运行时刻
 *   RESTORE_PREFIX 对象前缀，默认 uploads/
 *   RESTORE_CONCURRENCY  并发删除数，默认 20
 *   DRY_RUN=1      仅预览
 *
 * 示例（恢复 6/10～6/26 之间打的删除标记）：
 *   DRY_RUN=1 RESTORE_START="2026-06-10T00:00:00+08:00" RESTORE_END="2026-06-26T23:59:59+08:00" yarn restore-cos-markers
 *   RESTORE_START="2026-06-10T00:00:00+08:00" RESTORE_END="2026-06-26T23:59:59+08:00" yarn restore-cos-markers
 */
import path from "path";
import dotenv from "dotenv";
import COS from "cos-nodejs-sdk-v5";

dotenv.config({ path: path.join(__dirname, "../.env") });

type DeleteMarkerRow = {
    Key: string;
    VersionId: string;
    LastModified: string;
    IsLatest?: string | boolean;
};

type ListVersionsResult = {
    DeleteMarkers?: DeleteMarkerRow[];
    IsTruncated?: boolean | string;
    NextKeyMarker?: string;
    NextVersionIdMarker?: string;
};

const DEFAULT_START = "2026-06-26T00:00:00+08:00";

function requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) {
        throw new Error(`缺少环境变量 ${name}，请在 .env 中配置`);
    }
    return v;
}

function parseTime(label: string, raw: string): Date {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        throw new Error(`${label} 时间格式无效: ${raw}`);
    }
    return d;
}

function cosPromise<T>(fn: (cb: (err: unknown, data: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
        fn((err, data) => (err ? reject(err) : resolve(data)));
    });
}

function isInTimeRange(lastModified: string, start: Date, end: Date): boolean {
    const t = parseTime("LastModified", lastModified);
    return t.getTime() >= start.getTime() && t.getTime() <= end.getTime();
}

function isAlreadyDeletedError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;
    return (
        code === "NoSuchVersion" ||
        code === "NoSuchKey" ||
        /NoSuchVersion/i.test(msg) ||
        /404/i.test(msg)
    );
}

/** 分页列出前缀内 DeleteMarker，仅保留时间范围内的条目（避免全量载入内存） */
async function listDeleteMarkersInRange(
    cos: COS,
    bucket: string,
    region: string,
    prefix: string,
    start: Date,
    end: Date
): Promise<{ matched: DeleteMarkerRow[]; totalScanned: number }> {
    const matched: DeleteMarkerRow[] = [];
    let totalScanned = 0;
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let page = 0;

    for (;;) {
        page += 1;
        const params: Record<string, unknown> = {
            Bucket: bucket,
            Region: region,
            Prefix: prefix,
            MaxKeys: 1000,
        };
        if (keyMarker) params.KeyMarker = keyMarker;
        if (versionIdMarker) params.VersionIdMarker = versionIdMarker;

        const data = await cosPromise<ListVersionsResult>((cb) =>
            cos.listObjectVersions(params as any, cb)
        );

        const batch = data.DeleteMarkers ?? [];
        let inRangeBatch = 0;
        for (const row of batch) {
            if (!row?.Key || !row?.VersionId) continue;
            totalScanned += 1;
            if (isInTimeRange(row.LastModified, start, end)) {
                matched.push(row);
                inRangeBatch += 1;
            }
        }

        const truncated = data.IsTruncated === true || data.IsTruncated === "true";
        if (page % 50 === 0 || !truncated) {
            console.log(
                `[list] page=${page} scanned=${totalScanned} matched=${matched.length} truncated=${truncated}`
            );
        }

        if (!truncated) break;

        keyMarker = data.NextKeyMarker;
        versionIdMarker = data.NextVersionIdMarker;
        if (!keyMarker && !versionIdMarker) {
            console.warn("[list] IsTruncated=true 但未返回 NextKeyMarker/NextVersionIdMarker，提前结束");
            break;
        }
    }

    return { matched, totalScanned };
}

async function deleteDeleteMarker(
    cos: COS,
    bucket: string,
    region: string,
    row: DeleteMarkerRow
): Promise<void> {
    await cosPromise((cb) =>
        cos.deleteObject(
            {
                Bucket: bucket,
                Region: region,
                Key: row.Key,
                VersionId: row.VersionId,
            } as Parameters<COS["deleteObject"]>[0],
            cb
        )
    );
}

async function runPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (;;) {
            const i = nextIndex;
            nextIndex += 1;
            if (i >= items.length) break;
            await worker(items[i]!, i);
        }
    });
    await Promise.all(runners);
}

async function main() {
    const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
    const bucket = requireEnv("COS_BUCKET");
    const region = requireEnv("COS_REGION");
    const secretId = requireEnv("COS_SECRET_ID");
    const secretKey = requireEnv("COS_SECRET_KEY");
    const prefix = process.env.RESTORE_PREFIX?.trim() || "uploads/";
    const concurrency = Math.min(
        50,
        Math.max(1, parseInt(process.env.RESTORE_CONCURRENCY || "20", 10) || 20)
    );

    const start = parseTime("RESTORE_START", process.env.RESTORE_START?.trim() || DEFAULT_START);
    const end = parseTime(
        "RESTORE_END",
        process.env.RESTORE_END?.trim() || new Date().toISOString()
    );

    if (start.getTime() > end.getTime()) {
        throw new Error("RESTORE_START 不能晚于 RESTORE_END");
    }

    console.log("=== COS DeleteMarker 批量恢复 ===");
    console.log(`Bucket: ${bucket}`);
    console.log(`Region: ${region}`);
    console.log(`Prefix: ${prefix}`);
    console.log(`Time range: ${start.toISOString()} ~ ${end.toISOString()}`);
    console.log(`Concurrency: ${concurrency}`);
    console.log(`Mode: ${dryRun ? "DRY_RUN（仅预览）" : "EXECUTE（将删除删除标记）"}`);
    console.log("");

    const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

    const { matched: toDelete, totalScanned } = await listDeleteMarkersInRange(
        cos,
        bucket,
        region,
        prefix,
        start,
        end
    );

    // 同一 Key 可能有多条删除标记，按时间从新到旧删
    toDelete.sort(
        (a, b) =>
            parseTime("LastModified", b.LastModified).getTime() -
            parseTime("LastModified", a.LastModified).getTime()
    );

    const keysAffected = new Set(toDelete.map((m) => m.Key));
    console.log("");
    console.log(`DeleteMarker 扫描总数（前缀内）: ${totalScanned}`);
    console.log(`时间范围内待删 DeleteMarker: ${toDelete.length}`);
    console.log(`涉及对象 Key 数: ${keysAffected.size}`);
    console.log("");

    if (toDelete.length === 0) {
        console.log("没有匹配的 DeleteMarker，退出。");
        return;
    }

    const preview = toDelete.slice(0, 20);
    console.log("样例（最多 20 条）:");
    for (const m of preview) {
        console.log(`  ${m.Key}  ${m.LastModified}  versionId=${m.VersionId}`);
    }
    if (toDelete.length > 20) {
        console.log(`  ... 另有 ${toDelete.length - 20} 条`);
    }
    console.log("");

    if (dryRun) {
        console.log("DRY_RUN=1，未执行删除。确认无误后去掉 DRY_RUN 再运行。");
        return;
    }

    let ok = 0;
    let skip = 0;
    let fail = 0;
    let done = 0;
    const startedAt = Date.now();

    await runPool(toDelete, concurrency, async (m) => {
        try {
            await deleteDeleteMarker(cos, bucket, region, m);
            ok += 1;
        } catch (e: unknown) {
            if (isAlreadyDeletedError(e)) {
                skip += 1;
            } else {
                fail += 1;
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[fail] ${m.Key} versionId=${m.VersionId}: ${msg}`);
            }
        }
        done += 1;
        if (done % 500 === 0 || done === toDelete.length) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
            console.log(
                `[progress] ${done}/${toDelete.length} 成功 ${ok} 已不存在 ${skip} 失败 ${fail} 耗时 ${elapsed}s`
            );
        }
    });

    console.log("");
    console.log(`完成: 成功 ${ok}, 已不存在(跳过) ${skip}, 失败 ${fail}`);
    console.log("请抽样访问 https://你的域名/uploads/xxx.png 或通过 COS 控制台确认当前版本已变为数据文件。");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
