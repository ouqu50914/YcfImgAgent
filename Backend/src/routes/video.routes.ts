import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rate-limit.middleware";
import { createVideoTask, getVideoTask, listVideoTasks } from "../controllers/video.controller";

const router = Router();

// 创建视频任务：按 kling_video 单独限流
router.post(
    "/tasks",
    authenticateToken,
    rateLimit({ windowMs: 60_000, max: 5, apiType: "kling_video" }),
    createVideoTask
);

// 查询单个任务
router.get("/tasks/:id", authenticateToken, getVideoTask);

// 查询任务列表
router.get("/tasks", authenticateToken, listVideoTasks);

export default router;

