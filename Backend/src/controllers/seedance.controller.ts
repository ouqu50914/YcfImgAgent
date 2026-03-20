import { Request, Response } from "express";
import { SeedanceVideoAdapter, type SeedanceActionType } from "../adapters/seedance-video.adapter";
import { CreditService } from "../services/credit.service";

const adapter = new SeedanceVideoAdapter();
const creditService = new CreditService();

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
        return res.status(status).json({
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

        const result = await adapter.getVideoTask(id);

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

        return res.status(200).json({
            message: "获取 Seedance 视频任务成功",
            data: result,
        });
    } catch (error: any) {
        console.error("[SeedanceController] 获取任务失败:", error);
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600
                ? error.status
                : 500;
        return res.status(status).json({
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
        return res.status(status).json({
            message:
                error.message ||
                (status === 400
                    ? "请求参数或内容不符合 Seedance 要求，请检查后重试。"
                    : "创建 Seedance 高级视频生成任务失败"),
        });
    }
};

