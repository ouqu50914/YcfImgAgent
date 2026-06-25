import { Request, Response } from "express";
import { ChatSessionService, type ChatSessionDto } from "../services/chat-session.service";

const chatSessionService = new ChatSessionService();

function getUserId(req: Request): number | null {
    const raw = (req as any).user?.userId;
    if (raw == null) return null;
    const userId = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(userId) ? userId : null;
}

export const listChatSessions = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const sessions = await chatSessionService.listSessions(userId);
        return res.status(200).json({ message: "ok", data: { sessions } });
    } catch (error: any) {
        console.error("[ChatSessionController] listChatSessions error:", error?.message || error);
        return res.status(500).json({ message: error.message || "获取会话失败" });
    }
};

export const upsertChatSession = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const session = req.body?.session as ChatSessionDto | undefined;
        if (!session?.id) {
            return res.status(400).json({ message: "会话数据无效" });
        }

        const saved = await chatSessionService.upsertSession(userId, session);
        return res.status(200).json({ message: "ok", data: saved });
    } catch (error: any) {
        console.error("[ChatSessionController] upsertChatSession error:", error?.message || error);
        return res.status(500).json({ message: error.message || "保存会话失败" });
    }
};

export const bulkUpsertChatSessions = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const sessions = req.body?.sessions as ChatSessionDto[] | undefined;
        if (!Array.isArray(sessions)) {
            return res.status(400).json({ message: "sessions 必须为数组" });
        }

        const count = await chatSessionService.bulkUpsertSessions(userId, sessions);
        return res.status(200).json({ message: "ok", data: { count } });
    } catch (error: any) {
        console.error("[ChatSessionController] bulkUpsertChatSessions error:", error?.message || error);
        return res.status(500).json({ message: error.message || "同步会话失败" });
    }
};

export const deleteChatSession = async (req: Request, res: Response) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const sessionId = req.params.sessionId;
        if (typeof sessionId !== "string" || !sessionId) {
            return res.status(400).json({ message: "会话 ID 无效" });
        }

        const ok = await chatSessionService.deleteSession(userId, sessionId);
        if (!ok) {
            return res.status(404).json({ message: "会话不存在" });
        }

        return res.status(200).json({ message: "ok" });
    } catch (error: any) {
        console.error("[ChatSessionController] deleteChatSession error:", error?.message || error);
        return res.status(500).json({ message: error.message || "删除会话失败" });
    }
};
