import { Router } from "express";
import { generateImage, upscaleImage, extendImage, splitImage } from "../controllers/image.controller";
import { uploadImage, uploadImages, upload } from "../controllers/upload.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimitByApiType } from "../middlewares/rate-limit.middleware";

const router = Router();

// 这一组路由全部需要登录，并应用限流
router.post("/generate", authenticateToken, rateLimitByApiType, generateImage);
router.post("/upscale", authenticateToken, rateLimitByApiType, upscaleImage);
router.post("/extend", authenticateToken, rateLimitByApiType, extendImage);
router.post("/split", authenticateToken, rateLimitByApiType, splitImage);

// 图片上传接口（启用 COS 时仅传 COS 不落盘）
router.post("/upload", authenticateToken, upload("image", true), uploadImage);
router.post("/upload/multiple", authenticateToken, upload("images", false), uploadImages);

export default router;