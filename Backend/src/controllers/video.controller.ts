import { Request, Response } from "express";
import { VideoService, type CreateVideoTaskInput } from "../services/video.service";
import { ErrorLogService } from "../services/error-log.service";

const videoService = new VideoService();
const errorLogService = new ErrorLogService();

export const createVideoTask = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const { mode, prompt, imageUrl, endImageUrl, imageUrls, imageSubType, duration, resolution, aspectRatio, style, fps, seed, klingMode } = req.body;

        if (!mode || !["text_to_video", "image_to_video", "omni"].includes(mode)) {
            return res.status(400).json({ message: "mode 必须是 text_to_video / image_to_video / omni 之一" });
        }

        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ message: "prompt 为必填项" });
        }

        if (mode === "image_to_video") {
            const hasMulti = Array.isArray(imageUrls) && imageUrls.length > 0;
            const hasSingle = imageUrl != null && String(imageUrl).trim() !== "";
            const hasFirstLast = hasSingle && endImageUrl != null && String(endImageUrl).trim() !== "";
            if (imageSubType === "first_last") {
                if (!hasSingle || !hasFirstLast) {
                    return res.status(400).json({ message: "首尾帧（一镜到底）模式下必须同时提供首帧 imageUrl 和尾帧 endImageUrl" });
                }
            } else if (imageSubType === "multi_shot") {
                if (!hasMulti) {
                    return res.status(400).json({ message: "多图多镜头模式下必须提供 imageUrls（至少一张）" });
                }
            } else {
                if (!hasSingle && !hasMulti) {
                    return res.status(400).json({ message: "image_to_video 模式下必须提供 imageUrl 或 imageUrls" });
                }
            }
        }

        const input: CreateVideoTaskInput = {
            mode,
            prompt,
        };
        if (imageUrl != null) input.imageUrl = imageUrl;
        if (endImageUrl != null) input.endImageUrl = endImageUrl;
        if (Array.isArray(imageUrls) && imageUrls.length > 0) input.imageUrls = imageUrls;
        if (imageSubType != null && ["first_only", "first_last", "multi_shot"].includes(imageSubType)) {
            input.imageSubType = imageSubType;
        }
        if (duration != null) input.duration = duration;
        if (resolution != null) input.resolution = resolution;
        if (aspectRatio != null) input.aspectRatio = aspectRatio;
        if (style != null) input.style = style;
        if (fps != null) input.fps = fps;
        if (seed != null) input.seed = seed;
        if (klingMode === "pro") input.klingMode = "pro";

        const task = await videoService.createTask(userId, input);

        return res.status(200).json({
            message: "视频生成任务创建成功",
            data: task,
        });
    } catch (error: any) {
        console.error("[VideoController] 创建任务失败:", error);
        errorLogService.recordFromRequest(req, error, { provider: "kling" });
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;

        if (status === 401) {
            return res.status(502).json({
                code: "UPSTREAM_UNAUTHORIZED",
                message: "视频服务鉴权失败，请检查 KLING_ACCESS_KEY / KLING_SECRET_KEY（或网络/账号权限），稍后重试。",
                trace_id: req.traceId,
            });
        }

        return res.status(status).json({
            code: error?.code,
            message: error.message || "创建视频生成任务失败",
            trace_id: req.traceId,
        });
    }
};

export const getVideoTask = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) {
            return res.status(400).json({ message: "任务 ID 非法" });
        }

        const task = await videoService.getTaskById(userId, id);
        return res.status(200).json({
            message: "获取任务成功",
            data: task,
        });
    } catch (error: any) {
        console.error("[VideoController] 获取任务失败:", error);
        errorLogService.recordFromRequest(req, error, { provider: "kling" });
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;

        if (status === 401) {
            return res.status(502).json({
                code: "UPSTREAM_UNAUTHORIZED",
                message: "视频服务鉴权失败，请稍后重试。",
                trace_id: req.traceId,
            });
        }

        return res.status(status).json({
            code: error?.code,
            message: error.message || "获取视频任务失败",
            trace_id: req.traceId,
        });
    }
};

export const listVideoTasks = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录或登录已失效" });
        }

        const { mode, status, limit } = req.query;
        const take = typeof limit === "string" ? Number(limit) : undefined;

        const listOptions: { mode?: string; status?: string; take?: number } = {};
        if (typeof mode === "string") listOptions.mode = mode;
        if (typeof status === "string") listOptions.status = status;
        if (typeof take === "number" && !Number.isNaN(take)) listOptions.take = take;

        const tasks = await videoService.listTasks(userId, listOptions);

        return res.status(200).json({
            message: "获取任务列表成功",
            data: tasks,
        });
    } catch (error: any) {
        console.error("[VideoController] 列表查询失败:", error);
        errorLogService.recordFromRequest(req, error, { provider: "kling" });
        const status =
            typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;

        if (status === 401) {
            return res.status(502).json({
                code: "UPSTREAM_UNAUTHORIZED",
                message: "视频服务鉴权失败，请稍后重试。",
                trace_id: req.traceId,
            });
        }

        return res.status(status).json({
            code: error?.code,
            message: error.message || "获取视频任务列表失败",
            trace_id: req.traceId,
        });
    }
};

