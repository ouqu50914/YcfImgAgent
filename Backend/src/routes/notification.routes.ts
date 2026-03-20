import { Router, type Request, type Response } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { notificationService } from "../services/notification.service";

const router = Router();

/**
 * 超级管理员 SSE：实时推送积分申请通知
 * GET /api/notifications/admin/stream
 */
router.get("/admin/stream", authenticateToken, (req: Request, res: Response) => {
    const userId = (req as any).user?.userId as number | undefined;
    const roleRaw = (req as any).user?.role;
    const role = roleRaw == null ? NaN : Number(roleRaw);

    if (!userId) {
        return res.status(401).json({ message: "未登录" });
    }
    if (Number.isNaN(role) || role !== 1) {
        return res.status(403).json({ message: "需要超级管理员权限" });
    }

    // SSE 基础响应头
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 部分中间件/Node 版本会提供 flushHeaders
    if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
    }

    // 建连成功后推送一个事件，前端可用于初始化
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ userId })}\n\n`);

    const client = notificationService.addAdminClient(res);

    const heartbeat = setInterval(() => {
        try {
            notificationService.emitAdmin("ping", { ts: Date.now() });
        } catch {
            // emitAdmin 内部会处理异常并移除连接，这里无需额外动作
        }
    }, 25000);

    req.on("close", () => {
        clearInterval(heartbeat);
        notificationService.removeAdminClient(client);
    });
});

export default router;

