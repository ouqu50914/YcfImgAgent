import { Request, Response } from "express";
import axios from "axios";
import { PromptService } from "../services/prompt.service";
import { LogService } from "../services/log.service";

const promptService = new PromptService();
const logService = new LogService();

/**
 * 优化提示词
 */
export const optimizePrompt = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { prompt, apiType, style } = req.body;

        if (!prompt) {
            return res.status(400).json({ message: "提示词不能为空" });
        }

        const optimizedPrompt = await promptService.optimizePrompt(prompt, {
            apiType: apiType || 'dream',
            style
        });

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            details?: any;
            ipAddress?: string;
        } = {
            details: { originalPrompt: prompt, optimizedPrompt, apiType, style }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        if (userId) {
            await logService.logOperation(userId, 'optimize', logOptions);
        }

        return res.status(200).json({
            message: "提示词优化成功",
            data: {
                original: prompt,
                optimized: optimizedPrompt
            }
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * Gemini 聊天接口
 */
export const geminiChat = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { message, history, workflowContext, temperature, maxTokens } = req.body || {};

        if (!message || typeof message !== "string") {
            return res.status(400).json({ message: "message 不能为空" });
        }

        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];

        messages.push({
            role: "system",
            content: "你是一个帮助用户编辑和管理 AI 工作流的智能助手，可以根据用户问题提供建议、解释和操作步骤。"
        });

        if (Array.isArray(history)) {
            for (const item of history) {
                if (!item || typeof item !== "object") continue;
                const role = item.role === "assistant" ? "assistant" : "user";
                if (typeof item.content !== "string") continue;
                messages.push({ role, content: item.content });
            }
        }

        if (workflowContext) {
            messages.push({
                role: "system",
                content: `当前工作流上下文信息：${JSON.stringify(workflowContext).slice(0, 2000)}`
            });
        }

        messages.push({
            role: "user",
            content: message
        });

        const reply = await promptService.chatWithGemini(messages, {
            temperature,
            maxTokens
        });

        if (userId) {
            const ipAddressRaw = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            const logOptions: {
                details?: any;
                ipAddress?: string;
            } = {
                details: {
                    type: "gemini-chat",
                    message,
                    historyLength: Array.isArray(history) ? history.length : 0,
                    workflowContextSummary: workflowContext ? Object.keys(workflowContext) : undefined
                }
            };

            if (ipAddressRaw) {
                const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
                if (ipAddress && typeof ipAddress === "string") {
                    logOptions.ipAddress = ipAddress;
                }
            }

            await logService.logOperation(userId, "gemini_chat", logOptions);
        }

        return res.status(200).json({
            message: "ok",
            data: {
                reply
            }
        });
    } catch (error: any) {
        console.error("[PromptController] geminiChat error:", error?.message || error);
        return res.status(500).json({ message: error.message || "Gemini 聊天服务异常" });
    }
};

/**
 * Gemini 聊天接口（流式）
 * 将 Ace Data 的流式响应原样透传给前端（SSE / chunk）
 */
export const geminiChatStream = async (req: Request, res: Response) => {
    const { message, history, workflowContext, temperature, maxTokens } = req.body || {};

    if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "message 不能为空" });
    }

    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    const API_URL = process.env.GEMINI_CHAT_API_URL;
    const MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash";

    if (!API_KEY || !API_URL) {
        return res.status(500).json({ message: "Gemini 聊天服务未正确配置" });
    }

    const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];

    messages.push({
        role: "system",
        content: "你是一个帮助用户编辑和管理 AI 工作流的智能助手，可以根据用户问题提供建议、解释和操作步骤。"
    });

    if (Array.isArray(history)) {
        for (const item of history) {
            if (!item || typeof item !== "object") continue;
            const role = item.role === "assistant" ? "assistant" : "user";
            if (typeof item.content !== "string") continue;
            messages.push({ role, content: item.content });
        }
    }

    if (workflowContext) {
        messages.push({
            role: "system",
            content: `当前工作流上下文信息：${JSON.stringify(workflowContext).slice(0, 2000)}`
        });
    }

    messages.push({
        role: "user",
        content: message
    });

    // SSE 头
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    res.flushHeaders && res.flushHeaders();

    try {
        const aceRes = await axios.post(
            API_URL,
            {
                model: MODEL,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: true
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_KEY}`,
                },
                responseType: "stream",
            }
        );

        aceRes.data.on("data", (chunk: Buffer) => {
            res.write(chunk.toString());
        });

        aceRes.data.on("end", () => {
            res.end();
        });

        aceRes.data.on("error", (err: any) => {
            console.error("[PromptController] geminiChatStream upstream error:", err?.message || err);
            res.write(`event: error\ndata: ${JSON.stringify({ message: "上游 Gemini 流式出错" })}\n\n`);
            res.end();
        });
    } catch (error: any) {
        console.error("[PromptController] geminiChatStream request error:", error?.message || error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: error?.message || "Gemini 流式调用失败" })}\n\n`);
        res.end();
    }
};
