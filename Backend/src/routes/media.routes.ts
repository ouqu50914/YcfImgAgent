import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rate-limit.middleware";
import { probeMedia } from "../controllers/media.controller";

const router = Router();

// 外链媒体探测：用于校验参考视频/音频时长与大小（防止 Seedance 侧失败）
router.post(
    "/probe",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 20, apiType: "media_probe" }),
    probeMedia
);

export default router;

