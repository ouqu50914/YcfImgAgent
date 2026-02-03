import { Router } from "express";
import { splitLayer } from "../controllers/layer.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

// 图层拆分接口（需要登录）
router.post("/split", authenticateToken, splitLayer);

export default router;
