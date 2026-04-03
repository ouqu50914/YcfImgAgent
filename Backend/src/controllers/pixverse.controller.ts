import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { VideoTask } from "../entities/VideoTask";
import { CreditService } from "../services/credit.service";
import { PixverseVideoAdapter, type PixverseCreateTextGenerateInput } from "../adapters/pixverse-video.adapter";
import { parseTemplateIdFromBody } from "../utils/template-id";

const adapter = new PixverseVideoAdapter();
const creditService = new CreditService();
const videoTaskRepo = AppDataSource.getRepository(VideoTask);

/**
 * PixVerse Worker：
 * 创建任务后在后台轮询上游，直到拿到终态（succeeded/failed）。
 * 前端轮询 GET /pixverse/generations/:id，通过本地缓存避免错过回显窗口。
 */
const pixversePollingWorkers = new Map<string, Promise<void>>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function normalizePixverseStatusForUi(status?: number | null): string {
    const s = Number(status);
    if (!Number.isFinite(s) || s === 0) return "pending";
    // status 码来自 PixVerse：1=成功，5=处理中，7=审核相关（仍可能返回可播放 url），8=失败
    // 若 Resp 里已有 url，在 worker/GET 里用 hasVideoUrl 覆盖为 succeeded，避免「有片仍显示失败」
    if (s === 1) return "succeeded";
    if (s === 5) return "running";
    if (s === 7) return "failed";
    if (s === 8) return "failed";
    return "pending";
}

function buildPixverseResultFromTask(task: VideoTask) {
    // VideoTask.status 在我们落库时已是 UI 侧枚举（pending/running/succeeded/failed）
    const status = typeof task.status === "string" ? task.status : "pending";
    const videoUrl =
        Array.isArray(task.video_urls) && task.video_urls.length > 0 && typeof task.video_urls[0] === "string"
            ? task.video_urls[0]
            : null;

    const uiStatus = (status === "succeeded" && !videoUrl ? "running" : status) as any;

    return {
        // 防御：如果历史上写入了 succeeded 但没有 url，则对前端表现为 running，避免 0s 空视频
        status: uiStatus,
        progress: typeof task.progress === "number" ? task.progress : null,
        videoUrl,
        // 仅失败态返回 errorMessage，避免上游信封 ErrMsg=Success 污染 running 展示
        errorMessage: uiStatus === "failed" ? task.error_message ?? null : null,
    };
}

function getCreditsPerSecondByQuality(quality: string | undefined | null): number {
    const q = (quality ?? "").toLowerCase();
    if (q.includes("540p")) return 5;
    if (q.includes("720p")) return 7;
    if (q.includes("1080p")) return 14;
    // 兜底：如果拿到 4k 或其它未知 quality，按 1080p 计费
    return 14;
}

function normalizeAspectRatioForPixverse(aspectRatio: string | undefined | null): string {
    const v = (aspectRatio ?? "").trim();
    // UI 常见 "9:16"，PixVerse 文档要求 "9.16"
    if (v === "9:16") return "9.16";
    return v;
}

const startPixverseWorkerIfNeeded = (userId: number, providerTaskId: string) => {
    if (!providerTaskId) return;
    if (pixversePollingWorkers.has(providerTaskId)) return;

    const workerPromise = (async () => {
        const startedAt = Date.now();
        const MAX_WAIT_MS = 2 * 60 * 60 * 1000; // 最多后台等待 2 小时

        let delayMs = 5000; // PixVerse 建议 3-5 秒轮询，这里取 5 秒
        while (Date.now() - startedAt < MAX_WAIT_MS) {
            try {
                const result = await adapter.getVideoTask(providerTaskId);
                const normalizedStatusRaw = normalizePixverseStatusForUi(result?.status);
                const hasVideoUrl =
                    typeof result?.videoUrl === "string" && result.videoUrl.trim().length > 0;
                const normalizedStatus = hasVideoUrl
                    ? "succeeded"
                    : normalizedStatusRaw === "succeeded" && !hasVideoUrl
                      ? "running"
                      : normalizedStatusRaw;

                console.log("[PixVerseWorker] poll", {
                    providerTaskId,
                    statusRaw: result?.status,
                    statusRawUi: normalizedStatusRaw,
                    status: normalizedStatus,
                    hasVideoUrl,
                    videoUrl: hasVideoUrl ? result?.videoUrl : undefined,
                    errorMessage: result?.errorMessage ?? undefined,
                });

                let task = await videoTaskRepo.findOne({
                    where: { user_id: userId, provider: "pixverse", provider_task_id: providerTaskId },
                });

                if (!task) {
                    task = new VideoTask();
                    task.user_id = userId;
                    task.provider = "pixverse";
                    task.provider_task_id = providerTaskId;
                    task.type = "text_to_video";
                    task.request_params = null;
                }

                task.status = normalizedStatus;
                task.progress = null;
                task.error_message = normalizedStatus === "failed" ? result?.errorMessage ?? null : null;

                if (normalizedStatus === "succeeded") {
                    // 理论上 status=1 时会有 url；如果没拿到 url，仍继续等一小会儿再判失败
                    task.video_urls = hasVideoUrl ? [result.videoUrl as string] : [];
                    task.finished_at = new Date();
                    if (hasVideoUrl) {
                        await videoTaskRepo.save(task);
                        return;
                    }
                    // 没拿到 url：继续等，不直接 return
                } else if (normalizedStatus === "failed") {
                    task.video_urls = null;
                    task.finished_at = new Date();
                    await videoTaskRepo.save(task);
                    return;
                } else {
                    // pending/running：不覆盖 video_urls
                    task.video_urls = task.video_urls ?? null;
                }

                await videoTaskRepo.save(task);

                if (normalizedStatus === "pending" || normalizedStatus === "running") {
                    await sleep(delayMs);
                    continue;
                }

                return;
            } catch (e: any) {
                const statusCode: number | undefined = e?.status ?? e?.response?.status;
                const retryAfterSeconds: number | undefined =
                    typeof e?.response?.data?.retryAfter === "number" ? e.response.data.retryAfter : undefined;

                if (statusCode === 429 && typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
                    delayMs = Math.min(Math.max(retryAfterSeconds * 1000, delayMs), 120000);
                } else {
                    delayMs = Math.min(Math.round(delayMs * 1.5), 60000);
                }
                await sleep(delayMs);
            }
        }
    })();

    pixversePollingWorkers.set(providerTaskId, workerPromise);
    workerPromise.finally(() => pixversePollingWorkers.delete(providerTaskId));
};

export const createPixverseGeneration = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        // PixVerse 生成：支持文生/图生（不支持多模态）
        const {
            prompt,
            mode,
            aspect_ratio,
            aspectRatio,
            duration,
            quality,
            resolution,
            model,
            generate_audio_switch,
            imageUrl,
            endImageUrl,
            imageUrls,
            imageRefNames,
            imageFigureNumbers,
        } = req.body || {};

        const promptStr = typeof prompt === "string" ? prompt : "";
        if (!promptStr) {
            return res.status(400).json({ message: "prompt 为必填项" });
        }

        const durationNumRaw = Number(duration);
        if (!Number.isFinite(durationNumRaw) || durationNumRaw < 0 || durationNumRaw > 15) {
            return res.status(400).json({ message: "duration 需为 0~15 秒（V6 文档口径）" });
        }

        // 若 duration=0：按默认时长兜底（避免 PixVerse 不接受 0）
        const defaultDuration = Number(process.env.PIXVERSE_DEFAULT_DURATION ?? 5);
        const durationSeconds = durationNumRaw === 0 ? defaultDuration : durationNumRaw;
        if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 15) {
            return res.status(400).json({ message: "duration 最终值需为 1~15 秒" });
        }

        const qualityStr = String(quality ?? resolution ?? "");
        if (!qualityStr.trim()) {
            return res.status(400).json({ message: "quality（或 resolution）为必填项" });
        }

        // 不同模式对 duration 的上游约束不同；这里把 1~15 映射成合法值，保证前后端计费一致。
        let effectiveDurationSeconds =
            mode === "image_to_video_first_last"
                ? durationSeconds <= 5
                    ? 5
                    : 8
                : mode === "fusion_multi_subject"
                  ? durationSeconds <= 5
                      ? 5
                      : durationSeconds <= 8
                        ? 8
                        : 10
                  : durationSeconds;

        // fusion：v5.5/5.6 支持 5/8/10；1080p 时不可用 10（与官方文档一致）
        if (mode === "fusion_multi_subject") {
            const qLow = qualityStr.toLowerCase();
            if ((qLow.includes("1080") || qLow === "1080p") && effectiveDurationSeconds === 10) {
                effectiveDurationSeconds = 8;
            }
        }

        const arRaw = String(aspect_ratio ?? aspectRatio ?? "");
        const ar = normalizeAspectRatioForPixverse(arRaw);
        if (!ar.trim()) {
            return res.status(400).json({ message: "aspect_ratio 为空" });
        }

        // PixVerse：最多支持 7 张图片（即使当前模式只用 1~2 张，也做上限防御）
        const imgList = Array.isArray(imageUrls) ? imageUrls : [];
        const imgsFromFields: string[] = [];
        if (typeof imageUrl === "string" && imageUrl.trim()) imgsFromFields.push(imageUrl.trim());
        if (typeof endImageUrl === "string" && endImageUrl.trim()) imgsFromFields.push(endImageUrl.trim());
        const totalImageCount = imgsFromFields.length + imgList.length;
        if (totalImageCount > 7) {
            return res.status(400).json({ message: "PixVerse 最多支持 7 张图片（请减少连线图片数量）" });
        }

        const creditsPerSecond = getCreditsPerSecondByQuality(qualityStr);
        const cost = Math.round(effectiveDurationSeconds) * creditsPerSecond;
        const templateId = parseTemplateIdFromBody(req.body);

        await creditService.deductCredits(userId, cost);

        let upstreamResult: any;
        try {
            const payloadBase: Omit<PixverseCreateTextGenerateInput, "model"> = {
                aspect_ratio: ar as any,
                duration: Math.round(effectiveDurationSeconds),
                prompt: promptStr,
                quality: qualityStr as any,
                generate_audio_switch: generate_audio_switch ?? true,
            };

            const payload: PixverseCreateTextGenerateInput = model
                ? { ...payloadBase, model: String(model) }
                : payloadBase;

            if (mode === "image_to_video_first_only") {
                const urls: string[] = [];
                if (typeof imageUrl === "string" && imageUrl.trim()) urls.push(imageUrl.trim());
                if (Array.isArray(imageUrls)) {
                    for (const u of imageUrls) {
                        if (typeof u === "string" && u.trim()) urls.push(u.trim());
                    }
                }
                const uniq = Array.from(new Set(urls));
                if (uniq.length < 1) {
                    throw new Error("imageUrl（或 imageUrls）至少需要 1 张图片");
                }
                if (uniq.length > 7) {
                    throw new Error("PixVerse 最多支持 7 张图片（请减少连线图片数量）");
                }

                upstreamResult = await adapter.createImageGenerateFromUrls({
                    // 图生接口仅支持单张 img_id；adapter 仅消费首张 URL
                    imageUrls: [uniq[0]!],
                    aspect_ratio: ar,
                    duration: Math.round(effectiveDurationSeconds),
                    prompt: promptStr,
                    quality: qualityStr,
                    generate_audio_switch: generate_audio_switch ?? true,
                    ...(model ? { model: String(model) } : {}),
                });
            } else if (mode === "fusion_multi_subject") {
                const urls: string[] = [];
                if (typeof imageUrl === "string" && imageUrl.trim()) urls.push(imageUrl.trim());
                if (typeof endImageUrl === "string" && endImageUrl.trim()) urls.push(endImageUrl.trim());
                if (Array.isArray(imageUrls)) {
                    for (const u of imageUrls) {
                        if (typeof u === "string" && u.trim()) urls.push(u.trim());
                    }
                }
                const rawRefs = Array.isArray(imageRefNames)
                    ? (imageRefNames as unknown[]).map((x) => (typeof x === "string" ? x.trim() : ""))
                    : [];
                const rawFigures = Array.isArray(imageFigureNumbers)
                    ? (imageFigureNumbers as unknown[]).map((x) =>
                          typeof x === "number" && Number.isFinite(x) ? x : Number.NaN
                      )
                    : [];
                const uniq: string[] = [];
                const alignedRefs: string[] = [];
                const alignedFigures: number[] = [];
                const seenUrl = new Set<string>();
                for (let i = 0; i < urls.length; i++) {
                    const u = urls[i]!;
                    if (seenUrl.has(u)) continue;
                    seenUrl.add(u);
                    uniq.push(u);
                    alignedRefs.push(rawRefs[i] ?? "");
                    const figN = rawFigures[i];
                    alignedFigures.push(
                        typeof figN === "number" && Number.isFinite(figN) && figN >= 1
                            ? figN
                            : uniq.length
                    );
                }
                if (uniq.length < 2) {
                    throw new Error("PixVerse 多主体模式至少需要 2 张图片");
                }
                if (uniq.length > 7) {
                    throw new Error("PixVerse 最多支持 7 张图片（请减少连线图片数量）");
                }

                upstreamResult = await adapter.createFusionGenerateFromUrls({
                    imageUrls: uniq.slice(0, 7),
                    ...(alignedRefs.length === uniq.length ? { refNames: alignedRefs.slice(0, 7) } : {}),
                    ...(alignedFigures.length === uniq.length ? { figureNumbers: alignedFigures.slice(0, 7) } : {}),
                    aspect_ratio: ar,
                    duration: Math.round(effectiveDurationSeconds),
                    prompt: promptStr,
                    quality: qualityStr,
                    generate_audio_switch: generate_audio_switch ?? true,
                    ...(model ? { model: String(model) } : {}),
                });
            } else if (mode === "image_to_video_first_last") {
                if (typeof imageUrl !== "string" || !imageUrl.trim()) {
                    throw new Error("imageUrl（首帧）为必填项");
                }
                if (typeof endImageUrl !== "string" || !endImageUrl.trim()) {
                    throw new Error("endImageUrl（尾帧）为必填项");
                }

                upstreamResult = await adapter.createTransitionGenerateFromUrls({
                    firstImageUrl: imageUrl,
                    lastImageUrl: endImageUrl,
                    prompt: promptStr,
                    aspect_ratio: ar,
                    duration: Math.round(effectiveDurationSeconds),
                    quality: qualityStr,
                    ...(model ? { model: String(model) } : {}),
                    generate_audio_switch: generate_audio_switch ?? true,
                });
            } else {
                upstreamResult = await adapter.createTextGenerate(payload);
            }
        } catch (e) {
            // 调用失败：回滚积分
            await creditService.addCredits(userId, cost);
            throw e;
        }

        // 落库终态缓存（避免前端轮询过程中遇到上游 429 错过窗口）
        const providerTaskIdRaw = upstreamResult?.video_id ?? upstreamResult?.videoId ?? upstreamResult?.id;
        const videoIdNum = Number(providerTaskIdRaw);
        if (!Number.isFinite(videoIdNum)) {
            // 理论上 adapter 已校验；这里兜底回滚积分，避免产生“扣费但无任务”的状态
            await creditService.addCredits(userId, cost);
            return res.status(502).json({
                code: "PIXVERSE_INVALID_VIDEO_ID",
                message: "PixVerse 返回缺少有效的 video_id",
            });
        }

        const providerTaskId = String(videoIdNum);
        console.log("[PixVerseController] created", {
            userId,
            mode: mode ?? "text_to_video",
            providerTaskId,
            duration: Math.round(effectiveDurationSeconds),
            quality: qualityStr,
            aspect_ratio: ar,
        });
        try {
            const task = new VideoTask();
            task.user_id = userId;
            task.provider = "pixverse";
            task.type =
                mode === "image_to_video_first_last"
                    ? "image_to_video_first_last"
                    : mode === "image_to_video_first_only"
                      ? "image_to_video_first_only"
                      : mode === "fusion_multi_subject"
                        ? "fusion_multi_subject"
                        : "text_to_video";
            task.request_params = {
                prompt: promptStr,
                aspect_ratio: ar,
                duration: Math.round(effectiveDurationSeconds),
                quality: qualityStr,
                model,
                generate_audio_switch: generate_audio_switch ?? true,
                mode: mode ?? "text_to_video",
                imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
                endImageUrl: typeof endImageUrl === "string" ? endImageUrl : undefined,
                imageUrls: Array.isArray(imageUrls)
                    ? imageUrls.filter((u: any) => typeof u === "string" && u.trim()).slice(0, 7)
                    : undefined,
            };
            task.provider_task_id = providerTaskId;
            task.status = "pending";
            task.progress = null;
            task.error_message = null;
            task.video_urls = null;
            task.finished_at = null;
            task.template_id = templateId;
            task.credits_spent = cost;
            await videoTaskRepo.save(task);

            startPixverseWorkerIfNeeded(userId, providerTaskId);
        } catch {
            // 保存失败不影响上游任务创建
        }

        return res.status(200).json({
            message: "PixVerse 视频生成任务创建成功",
            data: {
                video_id: videoIdNum,
                status: "pending",
                progress: null,
            },
        });
    } catch (error: any) {
        console.error("[PixVerseController] 创建任务失败:", error);

        // 积分不足：CreditService 抛的是中文 Error（无 status），统一映射为 400
        if (typeof error?.message === "string" && error.message.includes("积分不足")) {
            return res.status(400).json({ code: undefined, message: error.message });
        }

        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;

        if (status === 401) {
            return res.status(502).json({
                code: "UPSTREAM_UNAUTHORIZED",
                message: "视频服务鉴权失败，请检查 PIXVERSE_API_KEY（或网络/账号权限），稍后重试。",
            });
        }

        return res.status(status).json({
            code: error?.code,
            message: error?.message || "创建 PixVerse 视频生成任务失败",
        });
    }
};

export const getPixverseVideo = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const id = req.params.id;
        if (!id || typeof id !== "string") {
            return res.status(400).json({ message: "任务 ID 非法" });
        }

        const existingTask = await videoTaskRepo.findOne({
            where: { user_id: userId, provider: "pixverse", provider_task_id: id },
        });

        if (existingTask && existingTask.status === "succeeded") {
            // 防御：已缓存 succeeded 但视频链接可能不可达（CDN 负缓存/同步延迟/过期）。
            // 先探测缓存里的 videoUrl，只有可访问才短路返回；否则降级为 running 并继续同步上游。
            const cachedUrl =
                Array.isArray(existingTask.video_urls) && typeof existingTask.video_urls[0] === "string"
                    ? existingTask.video_urls[0]
                    : null;
            if (cachedUrl) {
                const probe = await adapter.probeVideoUrlAccessible(cachedUrl, { maxAttempts: 3 });
                if (probe.ok) {
                    return res.status(200).json({
                        message: "获取 PixVerse 视频任务成功",
                        data: buildPixverseResultFromTask(existingTask),
                    });
                }
                console.log("[PixVerseController] cache_video_unreachable", {
                    userId,
                    id,
                    status: existingTask.status,
                    cachedUrl,
                    probeStatus: probe.status,
                });
            }

            // 缓存不可用：降级为 running，避免前端持续请求 404
            try {
                existingTask.status = "running";
                existingTask.video_urls = [];
                await videoTaskRepo.save(existingTask);
            } catch {
                // ignore
            }
        }
        // 注意：不在此处短路返回 failed。历史上可能误标失败或上游稍后成功，
        // 必须继续拉取 PixVerse，否则前端会永久卡在「失败」。

        // 先按本地快照返回，避免上游限流导致卡住（但仍会尝试同步）
        let upstreamResult: any;
        try {
            upstreamResult = await adapter.getVideoTask(id);
        } catch (e) {
            if (existingTask) {
                return res.status(200).json({
                    message: "获取 PixVerse 视频任务成功",
                    data: buildPixverseResultFromTask(existingTask),
                });
            }
            throw e;
        }

        const normalizedStatusRaw = normalizePixverseStatusForUi(upstreamResult?.status);
        const hasVideoUrl =
            typeof upstreamResult?.videoUrl === "string" && upstreamResult.videoUrl.trim().length > 0;
        // 有可播放地址即以成功为准（避免上游状态码与 url 短暂不一致）
        const normalizedStatus = hasVideoUrl
            ? "succeeded"
            : normalizedStatusRaw === "succeeded" && !hasVideoUrl
              ? "running"
              : normalizedStatusRaw;

        console.log("[PixVerseController] status", {
            userId,
            id,
            statusRaw: upstreamResult?.status,
            status: normalizedStatus,
            hasVideoUrl,
            videoUrl: hasVideoUrl ? upstreamResult?.videoUrl : undefined,
            errorMessage: upstreamResult?.errorMessage ?? undefined,
        });

        try {
            const task =
                existingTask ||
                (() => {
                    const t = new VideoTask();
                    t.user_id = userId;
                    t.provider = "pixverse";
                    t.type = "text_to_video";
                    t.provider_task_id = id;
                    t.request_params = null;
                    t.status = "pending";
                    t.progress = null;
                    t.error_message = null;
                    t.video_urls = null;
                    t.finished_at = null;
                    return t;
                })();

            task.status = normalizedStatus;
            task.progress = null;
            task.error_message = normalizedStatus === "failed" ? upstreamResult?.errorMessage ?? null : null;

            if (normalizedStatus === "succeeded") {
                task.video_urls = hasVideoUrl ? [upstreamResult.videoUrl as string] : [];
                task.finished_at = new Date();
            } else if (normalizedStatus === "failed") {
                task.video_urls = null;
                task.finished_at = new Date();
            }

            await videoTaskRepo.save(task);
        } catch {
            // 同步失败：仍返回上游结果给前端避免卡住
        }

        return res.status(200).json({
            message: "获取 PixVerse 视频任务成功",
            data: {
                status: normalizedStatus,
                progress: null,
                videoUrl: upstreamResult?.videoUrl ?? null,
                errorMessage: normalizedStatus === "failed" ? upstreamResult?.errorMessage ?? null : null,
            },
        });
    } catch (error: any) {
        console.error("[PixVerseController] 获取任务失败:", error);
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;

        if (status === 401) {
            return res.status(502).json({
                code: "UPSTREAM_UNAUTHORIZED",
                message: "视频服务鉴权失败，请稍后重试。",
            });
        }

        return res.status(status).json({
            code: error?.code,
            message: error?.message || "获取 PixVerse 视频生成任务失败",
        });
    }
};

