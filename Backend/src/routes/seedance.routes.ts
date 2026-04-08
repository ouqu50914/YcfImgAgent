import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rate-limit.middleware";
import {
    createSeedanceVideo,
    getSeedanceVideo,
    createSeedanceAdvancedVideo,
    getSeedanceBillingConfig,
} from "../controllers/seedance.controller";

const router = Router();

// 计费参数（与扣费一致；供前端展示消耗）
router.get("/billing-config", authenticateToken, rateLimit({ windowMs: 60_000, max: 30, apiType: "seedance_video_status" }), getSeedanceBillingConfig);

// 创建 Seedance 简单文生视频任务
router.post(
    "/generations",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 5, apiType: "seedance_video" }),
    createSeedanceVideo
);

// 创建 Seedance 高级任务（图生首帧 / 首尾帧 / 多参考图等）
router.post(
    "/advanced",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 5, apiType: "seedance_video_advanced" }),
    createSeedanceAdvancedVideo
);

// 查询 Seedance 视频任务
router.get(
    "/generations/:id",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 30, apiType: "seedance_video_status" }),
    getSeedanceVideo
);

export default router;

