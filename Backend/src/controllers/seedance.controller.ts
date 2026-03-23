import { Request, Response } from "express";
import { SeedanceVideoAdapter, type SeedanceActionType } from "../adapters/seedance-video.adapter";
import { CreditService } from "../services/credit.service";
import { AppDataSource } from "../data-source";
import { VideoTask } from "../entities/VideoTask";

const adapter = new SeedanceVideoAdapter();
const creditService = new CreditService();
const videoTaskRepo = AppDataSource.getRepository(VideoTask);

/**
 * Seedance Worker：
 * 创建任务后在后台持续轮询上游，直到拿到终态（succeeded/failed/canceled）。
 * 前端只要能访问 GET /seedance/generations/:id，就能从本地缓存取到终态结果，
 * 避免前端轮询过程中遇到 429 时“错过回显窗口”。
 */
const seedancePollingWorkers = new Map<string, Promise<void>>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const startSeedanceWorkerIfNeeded = (userId: number, providerTaskId: string) => {
    if (!providerTaskId) return;
    if (seedancePollingWorkers.has(providerTaskId)) return;

    const workerPromise = (async () => {
        const startedAt = Date.now();
        const MAX_WAIT_MS = 2 * 60 * 60 * 1000; // 最多后台等待 2 小时

        let delayMs = 8000;
        let succeededWithoutUrlCount = 0;
        while (Date.now() - startedAt < MAX_WAIT_MS) {
            try {
                const result = await adapter.getVideoTask(providerTaskId);
                const normalizedStatus = normalizeSeedanceStatusForUi(result?.status);
                const hasVideoUrl =
                    typeof result?.videoUrl === "string" && result.videoUrl.trim().length > 0;

                let task =
                    await videoTaskRepo.findOne({
                        where: { user_id: userId, provider: "seedance", provider_task_id: providerTaskId },
                    });

                if (!task) {
                    task = new VideoTask();
                    task.user_id = userId;
                    task.provider = "seedance";
                    task.provider_task_id = providerTaskId;
                    task.type = "text";
                    task.request_params = null;
                }

                task.status = normalizedStatus;
                task.progress = typeof result?.progress === "number" ? result.progress : null;
                task.error_message = result?.errorMessage ?? null;

                if (normalizedStatus === "succeeded") {
                    task.video_urls =
                        hasVideoUrl ? [result.videoUrl as string] : [];
                    task.finished_at = new Date();
                    if (!hasVideoUrl) {
                        succeededWithoutUrlCount += 1;
                    } else {
                        succeededWithoutUrlCount = 0;
                    }
                } else if (normalizedStatus === "failed" || normalizedStatus === "canceled") {
                    task.video_urls = null;
                    task.finished_at = new Date();
                }

                await videoTaskRepo.save(task);

                if (normalizedStatus === "failed" || normalizedStatus === "canceled") return;
                if (normalizedStatus === "succeeded" && hasVideoUrl) return;

                // 非终态：恢复到基础轮询间隔
                delayMs = 8000;
                await sleep(delayMs);
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

    seedancePollingWorkers.set(providerTaskId, workerPromise);
    workerPromise.finally(() => seedancePollingWorkers.delete(providerTaskId));
};

function getSeedanceCreditsPerSecond(): number {
    const raw = process.env.SEEDANCE_CREDITS_PER_SECOND;
    const n = raw ? Number(raw) : 20;
    if (Number.isNaN(n) || n <= 0) return 20;
    return n;
}

function getSeedanceDefaultDuration(): number {
    const raw = process.env.SEEDANCE_DEFAULT_DURATION;
    const n = raw ? Number(raw) : 5;
    if (Number.isNaN(n)) return 5;
    return n;
}

function buildSeedanceUpstreamUnauthorizedResponse(err: any) {
    // Seedance/Kling 等上游鉴权失败时，通常会返回 401。
    // 这类 401 不应被前端当成“你的登录失效”，因此改成 502 并返回 code。
    const upstreamMsg =
        typeof err?.message === "string" && err.message.trim().length > 0 ? err.message.trim() : undefined;

    return {
        status: 502,
        code: "UPSTREAM_UNAUTHORIZED",
        message: "视频服务鉴权失败，请检查 SEEDANCE_API_KEY / SEEDANCE_ACCESS（或网络/账号权限），稍后重试。",
        details: upstreamMsg,
    };
}

function normalizeSeedanceStatusForUi(status?: string | null): string {
    const raw = (status || "").toLowerCase();
    if (!raw) return "pending";
    if (raw === "queued") return "pending";
    if (raw === "running" || raw === "processing") return "running";
    if (raw === "succeeded" || raw === "success") return "succeeded";
    if (raw === "failed" || raw === "error") return "failed";
    if (raw === "canceled" || raw === "cancelled") return "canceled";
    return "pending";
}

function buildSeedanceResultFromTask(task: VideoTask) {
    const status = normalizeSeedanceStatusForUi(task.status);
    const videoUrl =
        Array.isArray(task.video_urls) && task.video_urls.length > 0 ? task.video_urls[0] : null;

    return {
        raw: null,
        status: status as any,
        progress: typeof task.progress === "number" ? task.progress : null,
        videoUrl,
        duration: null,
        ratio: null,
        resolution: null,
        errorMessage: task.error_message ?? null,
    };
}

export const createSeedanceVideo = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        // 避免日志泄露提示词/外链等敏感内容，只打印字段名
        console.log("[SeedanceController] createSeedanceVideo request keys:", Object.keys(req.body || {}));

        const { prompt, ratio, duration, resolution, generateAudio, enableWebSearch } = req.body || {};

        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ message: "prompt 为必填项" });
        }

        let durationNum: number | undefined;
        if (duration !== undefined) {
            const n = Number(duration);
            if (Number.isNaN(n)) {
                return res.status(400).json({ message: "duration 必须是数字" });
            }
            if (!(n === -1 || (n >= 4 && n <= 15))) {
                return res.status(400).json({ message: "duration 需在 4-15 之间，或为 -1 表示自动" });
            }
            durationNum = n;
        }

        const payload: {
            prompt: string;
            ratio?: string;
            duration?: number;
            resolution?: string;
            generateAudio?: boolean;
            enableWebSearch?: boolean;
        } = {
            prompt,
            ratio,
            resolution,
            generateAudio,
            enableWebSearch,
        };

        if (durationNum !== undefined) {
            payload.duration = durationNum;
        }

        // 20 积分 / 秒（可通过 SEEDANCE_CREDITS_PER_SECOND 覆盖）；duration = -1 或未指定时按默认时长计算
        const defaultDuration = getSeedanceDefaultDuration();
        const creditsPerSecond = getSeedanceCreditsPerSecond();
        const seconds = durationNum === undefined || durationNum === -1 ? defaultDuration : durationNum;
        const cost = seconds * creditsPerSecond;

        await creditService.deductCredits(userId, cost);

        let result;
        try {
            result = await adapter.createVideoTask(payload);
        } catch (error) {
            // 调用失败时回滚积分
            await creditService.addCredits(userId, cost);
            throw error;
        }

        // 落库：为后续轮询提供“终态缓存”（避免上游限流导致前端拿不到终态）
        try {
            const providerTaskId = result?.task_id || result?.id;
            if (providerTaskId) {
                const task = new VideoTask();
                task.user_id = userId;
                task.provider = "seedance";
                task.type = "text";
                task.request_params = {
                    ratio,
                    duration: durationNum,
                    resolution,
                    generateAudio,
                    enableWebSearch,
                };
                task.provider_task_id = providerTaskId;
                task.status = normalizeSeedanceStatusForUi(result?.status);
                task.progress = typeof result?.progress === "number" ? result.progress : null;
                task.error_message = null;
                task.video_urls = null;
                task.finished_at = null;
                await videoTaskRepo.save(task);

                // 启动后台 worker：保证终态最终一定会落库
                startSeedanceWorkerIfNeeded(userId, providerTaskId);
            }
        } catch (e) {
            // 保存失败不影响任务创建；但如果失败，则无法保障终态回显
            console.error("[SeedanceController] 落库 seedance 任务失败:", e);
        }

        return res.status(200).json({
            message: "Seedance 视频生成任务创建成功",
            data: result,
        });
    } catch (error: any) {
        console.error("[SeedanceController] 创建任务失败:", error);
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600
                ? error.status
                : 500;
        if (status === 401) {
            const r = buildSeedanceUpstreamUnauthorizedResponse(error);
            return res.status(r.status).json({ code: r.code, message: r.message });
        }

        return res.status(status).json({
            code: undefined,
            message:
                error.message ||
                (status === 400
                    ? "请求参数或内容不符合 Seedance 要求，请检查后重试。"
                    : "创建 Seedance 视频生成任务失败"),
        });
    }
};

export const getSeedanceVideo = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const id = req.params.id;
        if (!id || typeof id !== "string") {
            return res.status(400).json({ message: "任务 ID 非法" });
        }

        console.log("[SeedanceController] getSeedanceVideo polling", { taskId: id });

        // 优先读本地缓存：如果已经是终态，就直接返回，避免上游限流导致前端拿不到结果
        const existingTask = await videoTaskRepo.findOne({
            where: {
                user_id: userId,
                provider: "seedance",
                provider_task_id: id,
            },
        });

        if (existingTask && ["succeeded", "failed", "canceled"].includes(normalizeSeedanceStatusForUi(existingTask.status))) {
            return res.status(200).json({
                message: "获取 Seedance 视频任务成功",
                data: buildSeedanceResultFromTask(existingTask),
            });
        }

        let result;
        try {
            result = await adapter.getVideoTask(id);
        } catch (error) {
            // 上游可能限流/抖动：如果我们已经有任务记录，则返回“最后一次已知状态”
            if (existingTask) {
                return res.status(200).json({
                    message: "获取 Seedance 视频任务成功",
                    data: buildSeedanceResultFromTask(existingTask),
                });
            }
            throw error;
        }

        console.log("[SeedanceController] getSeedanceVideo result", {
            taskId: id,
            status: result.status,
            progress: result.progress,
            hasVideoUrl: !!result.videoUrl,
            videoUrlHost: (() => {
                try {
                    return result.videoUrl ? new URL(result.videoUrl).host : null;
                } catch {
                    return null;
                }
            })(),
        });

        // 同步到本地：一旦拿到终态，后续不再依赖上游
        try {
            // 我们在上游查询时使用的就是 path 参数 `id`，因此落库/关联直接使用它最稳
            const providerTaskId = id;
            const task =
                existingTask ||
                (() => {
                    const t = new VideoTask();
                    t.user_id = userId;
                    t.provider = "seedance";
                    t.type = "text";
                    t.provider_task_id = providerTaskId;
                    t.request_params = null;
                    t.status = "pending";
                    t.progress = null;
                    t.error_message = null;
                    t.video_urls = null;
                    t.finished_at = null;
                    return t;
                })();

            const normalizedStatus = normalizeSeedanceStatusForUi(result?.status);
            task.status = normalizedStatus;
            task.progress = typeof result?.progress === "number" ? result.progress : null;
            task.error_message = result?.errorMessage ?? null;

            if (normalizedStatus === "succeeded") {
                task.video_urls =
                    typeof result?.videoUrl === "string" && result.videoUrl.trim().length > 0 ? [result.videoUrl] : [];
                task.finished_at = new Date();
            } else if (normalizedStatus === "failed" || normalizedStatus === "canceled") {
                task.video_urls = null;
                task.finished_at = new Date();
            }

            await videoTaskRepo.save(task);
        } catch (e) {
            console.error("[SeedanceController] 同步 seedance 任务状态失败:", e);
            // 状态同步失败时仍返回上游结果给前端，避免卡住
        }

        return res.status(200).json({
            message: "获取 Seedance 视频任务成功",
            data: {
                ...result,
                // 让前端状态枚举稳定（避免 queued/misc 状态显示异常）
                status: normalizeSeedanceStatusForUi(result?.status) as any,
                progress: result?.progress ?? null,
                videoUrl: result?.videoUrl ?? null,
                errorMessage: result?.errorMessage ?? null,
            },
        });
    } catch (error: any) {
        console.error("[SeedanceController] 获取任务失败:", error);
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600
                ? error.status
                : 500;
        if (status === 401) {
            const r = buildSeedanceUpstreamUnauthorizedResponse(error);
            return res.status(r.status).json({ code: r.code, message: r.message });
        }

        return res.status(status).json({
            code: undefined,
            message:
                error.message ||
                (status === 400
                    ? "请求参数或内容不符合 Seedance 要求，请检查后重试。"
                    : "获取 Seedance 视频生成任务失败"),
        });
    }
};

export const createSeedanceAdvancedVideo = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const {
            prompt,
            action,
            firstImageUrl,
            lastImageUrl,
            referenceImageUrls,
            referenceVideoUrls,
            referenceAudioUrls,
            ratio,
            duration,
            generateAudio,
            enableWebSearch,
        } = req.body || {};

        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ message: "prompt 为必填项" });
        }

        const allowedActions: SeedanceActionType[] = [
            "text",
            "image_first_frame",
            "image_first_last",
            "multi_modal",
        ];
        if (!action || !allowedActions.includes(action)) {
            return res.status(400).json({
                message: "action 必须是 text / image_first_frame / image_first_last / multi_modal 之一",
            });
        }

        let durationNum: number | undefined;
        if (duration !== undefined) {
            const n = Number(duration);
            if (Number.isNaN(n)) {
                return res.status(400).json({ message: "duration 必须是数字" });
            }
            if (!(n === -1 || (n >= 4 && n <= 15))) {
                return res.status(400).json({ message: "duration 需在 4-15 之间，或为 -1 表示自动" });
            }
            durationNum = n;
        }

        // 按动作类型进行必要校验
        if (action === "image_first_frame") {
            if (!firstImageUrl || typeof firstImageUrl !== "string") {
                return res.status(400).json({ message: "image_first_frame 模式下必须提供 firstImageUrl" });
            }
        } else if (action === "image_first_last") {
            if (!firstImageUrl || !lastImageUrl) {
                return res.status(400).json({ message: "image_first_last 模式下必须同时提供 firstImageUrl 与 lastImageUrl" });
            }
        } else if (action === "multi_modal") {
            const hasImages = Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0;
            const hasVideos = Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0;
            const hasAudios = Array.isArray(referenceAudioUrls) && referenceAudioUrls.length > 0;

            // 文档允许的组合：
            // 文本；文本+图片；文本+视频；文本+图片+音频；文本+图片+视频；文本+视频+音频；文本+图片+视频+音频
            // 这里只限制：音频不能单独存在（必须有图片或视频其中之一）。
            if (hasAudios && !hasImages && !hasVideos) {
                return res.status(400).json({
                    message: "referenceAudioUrls 不能单独使用，请同时提供参考图片或视频",
                });
            }
        }

        const resultDuration = durationNum === undefined || durationNum === -1 ? getSeedanceDefaultDuration() : durationNum;
        const creditsPerSecond = getSeedanceCreditsPerSecond();
        const advCost = resultDuration * creditsPerSecond;

        await creditService.deductCredits(userId, advCost);

        let result;
        try {
            result = await adapter.createAdvancedVideoTask({
            prompt,
            action,
            firstImageUrl,
            lastImageUrl,
            referenceImageUrls,
            referenceVideoUrls,
            referenceAudioUrls,
            ratio,
            ...(durationNum !== undefined ? { duration: durationNum } : {}),
            ...(req.body?.resolution ? { resolution: req.body.resolution } : {}),
            generateAudio,
            enableWebSearch,
        } as any);
        } catch (error) {
            await creditService.addCredits(userId, advCost);
            throw error;
        }

        // 落库：为后续轮询提供“终态缓存”（避免上游限流导致前端拿不到终态）
        try {
            const providerTaskId = result?.task_id || result?.id;
            if (providerTaskId) {
                const task = new VideoTask();
                task.user_id = userId;
                task.provider = "seedance";
                task.type = String(action); // <= 20 字符限制，action 本身就较短
                task.request_params = {
                    action,
                    ratio,
                    duration: durationNum,
                    resolution: req.body?.resolution,
                    generateAudio,
                    enableWebSearch,
                };
                task.provider_task_id = providerTaskId;
                task.status = normalizeSeedanceStatusForUi(result?.status);
                task.progress = typeof result?.progress === "number" ? result.progress : null;
                task.error_message = null;
                task.video_urls = null;
                task.finished_at = null;
                await videoTaskRepo.save(task);

                // 启动后台 worker：保证终态最终一定会落库
                startSeedanceWorkerIfNeeded(userId, providerTaskId);
            }
        } catch (e) {
            console.error("[SeedanceController] 落库 seedance 高级任务失败:", e);
        }

        return res.status(200).json({
            message: "Seedance 高级视频生成任务创建成功",
            data: result,
        });
    } catch (error: any) {
        console.error("[SeedanceController] 创建高级任务失败:", error);
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600
                ? error.status
                : 500;
        if (status === 401) {
            const r = buildSeedanceUpstreamUnauthorizedResponse(error);
            return res.status(r.status).json({ code: r.code, message: r.message });
        }

        return res.status(status).json({
            code: undefined,
            message:
                error.message ||
                (status === 400
                    ? "请求参数或内容不符合 Seedance 要求，请检查后重试。"
                    : "创建 Seedance 高级视频生成任务失败"),
        });
    }
};

