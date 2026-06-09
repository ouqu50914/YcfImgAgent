import { Request, Response } from "express";
import axios from "axios";
import { PromptService } from "../services/prompt.service";
import { LogService } from "../services/log.service";
// 已移除多模态相关导入，Gemini 现在作为普通聊天机器人使用

const promptService = new PromptService();
const logService = new LogService();

/** 工作流上下文 JSON 注入上限（需容纳多节点 COS 长链接） */
const WORKFLOW_CONTEXT_JSON_MAX_CHARS = 16000;

const GEMINI_WORKFLOW_SYSTEM_PROMPT =
    "你是一个友好的AI助手，能够用自然语言回答用户的问题。";

const GEMINI_ERROR_TRANSLATION_SYSTEM_PROMPT =
    "你是一个技术错误翻译助手。请将用户提供的错误信息翻译为简体中文，要求：\n" +
    "1. 保持原始技术语义和约束条件不变；\n" +
    "2. 术语优先采用开发者常用中文表达；\n" +
    "3. 输入中的英文短语和英文句子必须翻译成中文，不允许保留英文原句；\n" +
    "4. 必须完整翻译全部内容，不得省略、不得截断，不得只返回前半句；\n" +
    "5. URL、请求ID、状态码、模型名、错误码（如 PROHIBITED_CONTENT）等字面值原样保留；\n" +
    "6. 仅输出翻译后的中文文本，不要解释、不要加前后缀。";

const GEMINI_ERROR_TRANSLATION_RETRY_SYSTEM_PROMPT =
    "你是一个严格的技术错误翻译助手。请将用户错误信息逐句完整翻译为简体中文，要求：\n" +
    "1. 必须保留全部信息，不得总结，不得省略任何句子；\n" +
    "2. URL、请求ID、状态码、模型名、错误码（如 PROHIBITED_CONTENT）原样保留；\n" +
    "3. 英文句子必须翻译成中文，不允许保留整句英文；\n" +
    "4. 仅输出翻译后的完整中文文本，不要额外解释。";

const ERROR_TRANSLATION_MAX_CHARS = 2000;

function looksLikeIncompleteTranslation(original: string, translated: string): boolean {
    const o = original.trim();
    const t = translated.trim();
    if (!o || !t) return true;

    // 长错误文案如果翻译明显偏短，通常发生了摘要/截断
    if (o.length >= 120 && t.length < Math.floor(o.length * 0.45)) return true;

    // 原文包含明显尾段关键词，但翻译结果未覆盖时，判为不完整
    const tailMarkers = ["for more information", "request id", "prohibited_content", "status code"];
    const lowerOriginal = o.toLowerCase();
    const lowerTranslated = t.toLowerCase();
    for (const marker of tailMarkers) {
        if (lowerOriginal.includes(marker) && !lowerTranslated.includes(marker) && !t.includes("请求 ID") && !t.includes("状态码")) {
            return true;
        }
    }
    return false;
}

async function translateWithStrictRetry(params: {
    requestId: string;
    sourceMessage: string;
}): Promise<string> {
    const { requestId, sourceMessage } = params;
    const attempts: Array<{ systemPrompt: string; maxTokens: number }> = [
        { systemPrompt: GEMINI_ERROR_TRANSLATION_SYSTEM_PROMPT, maxTokens: 800 },
        { systemPrompt: GEMINI_ERROR_TRANSLATION_RETRY_SYSTEM_PROMPT, maxTokens: 1400 },
        {
            systemPrompt:
                GEMINI_ERROR_TRANSLATION_RETRY_SYSTEM_PROMPT +
                "\n补充要求：如果上一轮翻译不完整，这一轮必须补全到覆盖原文全部信息。",
            maxTokens: 1800
        },
    ];

    let lastTranslated = "";
    for (const [i, current] of attempts.entries()) {
        const translated = await promptService.chatWithGemini(
            [
                { role: "system", content: current.systemPrompt },
                { role: "user", content: sourceMessage },
            ],
            { temperature: 0, maxTokens: current.maxTokens, debugTag: `${requestId}_pass${i + 1}` }
        );
        lastTranslated = translated;
        const incomplete = looksLikeIncompleteTranslation(sourceMessage, translated);
        if (!incomplete) {
            return translated;
        }
        console.warn("[PromptController] translateErrorMessage 分段重试未通过完整性校验", {
            request_id: requestId,
            pass: i + 1,
            translated_length: translated.trim().length,
            translated_preview: translated.trim().slice(0, 220),
        });
    }
    return lastTranslated;
}

// 已移除工作流上下文读取功能

/** 将完整回复拆成 OpenAI 兼容 SSE 增量，供前端 sendGeminiChatStream 解析 */
function writeSseOpenAiStyleDeltas(res: Response, fullText: string) {
    const chunkSize = 64;
    for (let i = 0; i < fullText.length; i += chunkSize) {
        const piece = fullText.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
}

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
        const { message, history, temperature, maxTokens } = req.body || {};

        if (!message || typeof message !== "string") {
            return res.status(400).json({ message: "message 不能为空" });
        }

        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
        messages.push({ role: "system", content: GEMINI_WORKFLOW_SYSTEM_PROMPT });
        
        if (Array.isArray(history)) {
            for (const item of history) {
                if (!item || typeof item !== "object") continue;
                const role = item.role === "assistant" ? "assistant" : "user";
                if (typeof item.content !== "string") continue;
                messages.push({ role, content: item.content });
            }
        }
        
        messages.push({ role: "user", content: message });
        const reply = await promptService.chatWithGemini(messages, { temperature, maxTokens });

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
    const { message, history, temperature, maxTokens } = req.body || {};

    if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "message 不能为空" });
    }

    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    const API_URL = process.env.GEMINI_CHAT_API_URL;
    const MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash";

    if (!API_KEY) {
        return res.status(500).json({ message: "Gemini 聊天服务未正确配置（缺少 GEMINI_CHAT_API_KEY）" });
    }

    if (!API_URL) {
        return res.status(500).json({ message: "Gemini 聊天服务未正确配置（缺少 GEMINI_CHAT_API_URL）" });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    res.flushHeaders && res.flushHeaders();

    try {
        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
        messages.push({ role: "system", content: GEMINI_WORKFLOW_SYSTEM_PROMPT });
        
        if (Array.isArray(history)) {
            for (const item of history) {
                if (!item || typeof item !== "object") continue;
                const role = item.role === "assistant" ? "assistant" : "user";
                if (typeof item.content !== "string") continue;
                messages.push({ role, content: item.content });
            }
        }
        
        messages.push({ role: "user", content: message });

        const aceRes = await axios.post(
            API_URL,
            {
                model: MODEL,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: true,
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${API_KEY}`,
                },
                // 强制直连，不使用系统代理（如 HTTPS_PROXY）
                proxy: false,
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

/**
 * 翻译错误文案（用于前端 toast 展示）
 */
export const translateErrorMessage = async (req: Request, res: Response) => {
    try {
        const messageRaw = req.body?.message;
        if (typeof messageRaw !== "string" || !messageRaw.trim()) {
            return res.status(400).json({ message: "message 不能为空" });
        }

        const message = messageRaw.trim().slice(0, ERROR_TRANSLATION_MAX_CHARS);
        const requestId = `translate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        console.log("[PromptController] translateErrorMessage 收到请求", {
            request_id: requestId,
            original_length: messageRaw.trim().length,
            used_length: message.length,
            preview: message.slice(0, 260),
        });
        const translated = await translateWithStrictRetry({
            requestId,
            sourceMessage: message,
        });

        console.log("[PromptController] translateErrorMessage 翻译成功", {
            request_id: requestId,
            translated_length: translated.trim().length,
            translated_preview: translated.trim().slice(0, 260),
            translated_full: translated.trim(),
        });

        return res.status(200).json({
            message: "ok",
            data: {
                translated: translated.trim(),
            },
        });
    } catch (error: any) {
        console.error("[PromptController] translateErrorMessage error:", {
            message: error?.message || error,
            status: error?.response?.status,
            response_data: error?.response?.data,
        });
        return res.status(500).json({ message: error.message || "错误文案翻译失败" });
    }
};
