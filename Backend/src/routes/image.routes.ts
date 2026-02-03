import { Router } from "express";
import { generateImage, upscaleImage, extendImage } from "../controllers/image.controller";
import { uploadImage, uploadImages, upload } from "../controllers/upload.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimitByApiType } from "../middlewares/rate-limit.middleware";

const router = Router();

// 这一组路由全部需要登录，并应用限流
router.post("/generate", authenticateToken, rateLimitByApiType, generateImage);
router.post("/upscale", authenticateToken, rateLimitByApiType, upscaleImage);
router.post("/extend", authenticateToken, rateLimitByApiType, extendImage);

// 图片上传接口
router.post("/upload", authenticateToken, upload.single('image'), uploadImage);
router.post("/upload/multiple", authenticateToken, upload.array('images', 10), uploadImages);

export default router;