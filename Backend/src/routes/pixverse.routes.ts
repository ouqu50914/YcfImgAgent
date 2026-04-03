import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rate-limit.middleware";
import { createPixverseGeneration, getPixverseVideo } from "../controllers/pixverse.controller";

const router = Router();

// 创建 PixVerse 文生视频任务
router.post(
    "/generations",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 5, apiType: "pixverse_video" }),
    createPixverseGeneration
);

// 查询 PixVerse 任务状态
router.get(
    "/generations/:id",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 30, apiType: "pixverse_video_status" }),
    getPixverseVideo
);

export default router;

