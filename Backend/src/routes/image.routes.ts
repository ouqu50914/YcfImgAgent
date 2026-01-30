import { Router } from "express";
import { generateImage } from "../controllers/image.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

// 这一组路由全部需要登录
router.post("/generate", authenticateToken, generateImage);

export default router;