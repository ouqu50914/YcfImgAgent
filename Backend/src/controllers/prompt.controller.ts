import { Request, Response } from "express";
import axios from "axios";
import { PromptService } from "../services/prompt.service";
import { LogService } from "../services/log.service";
import {
    extractWorkflowMediaUrls,
    callGeminiMultimodal,
    callGeminiGenerateContent,
    requestGeminiChatVisionStream,
} from "../services/gemini-multimodal.service";

const promptService = new PromptService();
const logService = new LogService();

/** 工作流上下文 JSON 注入上限（需容纳多节点 COS 长链接） */
const WORKFLOW_CONTEXT_JSON_MAX_CHARS = 16000;

const GEMINI_WORKFLOW_SYSTEM_PROMPT =
    "你是一个帮助用户编辑和管理 AI 工作流的智能助手。你既要能用自然语言回答用户问题，也要能在用户提出“生成图片/生成视频”这类明确目标时，给出可由前端执行的结构化指令。\n\n" +
    "当且仅当用户明确要“生成图片/生成视频（或让系统自动搭建生成节点并连线）”时，必须输出一个可解析的指令 JSON。\n" +
    "输出格式（严格遵守）：先用 1-3 句简短自然语言说明你将要做什么；然后只输出一个 JSON 指令代码块，代码块外不要再出现第二个 JSON。\n" +
    "JSON 指令代码块使用 ```json 包裹，并保证 JSON 内内容可以直接 JSON.parse。\n\n" +
    "JSON 指令 schema（字段名必须一致）：\n" +
    "- intent: \"create_image_pipeline\" | \"create_video_pipeline\"\n" +
    "- promptText: string（提取/清洗后的最终提示词，可直接用于生成；不要包含“请点击执行”等说明）\n" +
    "- ui: { messageForUser?: string }（可选；用于前端展示）\n\n" +
    "当 workflowContext 中存在 selectedNodes 且非空时：在自然语言部分先复述你识别到的选中节点（按 type 简述即可），再给出 JSON 指令（如需要）。\n" +
    "若本请求中附带图片、视频或音频（多模态 parts），请结合媒体内容回答用户的描述、分析与优化建议。\n" +
    "若某选中节点带有 media 链接说明，这些是可访问的资源地址；多模态 parts 与之一致时表示同一批资源。\n" +
    "如果用户只是咨询/解释/优化提示词，而没有要求“生成图片/视频”，则不要输出 JSON 指令，只用自然语言回答。";

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

function workflowContextText(workflowContext: unknown): string {
    if (!workflowContext) return "";
    return `当前工作流上下文信息：${JSON.stringify(workflowContext).slice(0, WORKFLOW_CONTEXT_JSON_MAX_CHARS)}`;
}

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
        const { message, history, workflowContext, temperature, maxTokens } = req.body || {};

        if (!message || typeof message !== "string") {
            return res.status(400).json({ message: "message 不能为空" });
        }

        const mediaItems = extractWorkflowMediaUrls(workflowContext);
        const historyForMultimodal: { role: "user" | "assistant"; content: string }[] = [];
        if (Array.isArray(history)) {
            for (const item of history) {
                if (!item || typeof item !== "object") continue;
                const role = item.role === "assistant" ? "assistant" : "user";
                if (typeof item.content !== "string") continue;
                historyForMultimodal.push({ role, content: item.content });
            }
        }

        let reply: string;

        if (mediaItems.length > 0) {
            try {
                reply = await callGeminiMultimodal({
                    systemAndContextText: `${GEMINI_WORKFLOW_SYSTEM_PROMPT}\n\n${workflowContextText(workflowContext)}`,
                    userMessage: message,
                    history: historyForMultimodal,
                    mediaItems,
                    ...(typeof temperature === "number" ? { temperature } : {}),
                    ...(typeof maxTokens === "number" ? { maxOutputTokens: maxTokens } : {}),
                });
            } catch (mmErr: any) {
                const msg = String(mmErr?.message || mmErr || "");
                if (mediaItems.some((m) => m.kind === "video")) {
                    const isConfig = msg.includes("GEMINI_GENERATE_CONTENT_API_URL");
                    return res.status(isConfig ? 400 : 502).json({
                        message:
                            msg ||
                            (isConfig
                                ? "视频识别需配置 GEMINI_GENERATE_CONTENT_API_URL（见 Ace 文档 Gemini Generate Content API）"
                                : "视频识别调用失败"),
                    });
                }
                console.error(
                    "[PromptController] 多模态（图片）失败，回退纯文本 chat:",
                    mmErr?.message || mmErr
                );
                const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
                messages.push({ role: "system", content: GEMINI_WORKFLOW_SYSTEM_PROMPT });
                for (const h of historyForMultimodal) {
                    messages.push({ role: h.role, content: h.content });
                }
                if (workflowContext) {
                    messages.push({ role: "system", content: workflowContextText(workflowContext) });
                }
                messages.push({ role: "user", content: message });
                reply = await promptService.chatWithGemini(messages, { temperature, maxTokens });
            }
        } else {
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
            if (workflowContext) {
                messages.push({ role: "system", content: workflowContextText(workflowContext) });
            }
            messages.push({ role: "user", content: message });
            reply = await promptService.chatWithGemini(messages, { temperature, maxTokens });
        }

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
                    workflowContextSummary: workflowContext ? Object.keys(workflowContext) : undefined,
                    multimodal: mediaItems.length > 0,
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

    if (!API_KEY) {
        return res.status(500).json({ message: "Gemini 聊天服务未正确配置（缺少 GEMINI_CHAT_API_KEY）" });
    }

    const historyForMultimodal: { role: "user" | "assistant"; content: string }[] = [];
    if (Array.isArray(history)) {
        for (const item of history) {
            if (!item || typeof item !== "object") continue;
            const role = item.role === "assistant" ? "assistant" : "user";
            if (typeof item.content !== "string") continue;
            historyForMultimodal.push({ role, content: item.content });
        }
    }

    const mediaItems = extractWorkflowMediaUrls(workflowContext);

    if (!API_URL) {
        return res.status(500).json({ message: "Gemini 聊天服务未正确配置（缺少 GEMINI_CHAT_API_URL）" });
    }

    const multimodalPayload = {
        systemAndContextText: `${GEMINI_WORKFLOW_SYSTEM_PROMPT}\n\n${workflowContextText(workflowContext)}`,
        userMessage: message,
        history: historyForMultimodal,
        mediaItems,
        ...(typeof temperature === "number" ? { temperature } : {}),
        ...(typeof maxTokens === "number" ? { maxOutputTokens: maxTokens } : {}),
    };

    const hasVideo = mediaItems.some((m) => m.kind === "video");
    const genUrl = process.env.GEMINI_GENERATE_CONTENT_API_URL?.trim();

    if (mediaItems.length > 0 && hasVideo && !genUrl) {
        return res.status(400).json({
            message:
                "视频识别需配置 GEMINI_GENERATE_CONTENT_API_URL，请从 Ace 文档「Gemini Generate Content API」复制完整接口地址：" +
                "https://platform.acedata.cloud/documents/gemini-generate-content-api",
        });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    res.flushHeaders && res.flushHeaders();

    const pipeChatCompletionsStream = async () => {
        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
        messages.push({ role: "system", content: GEMINI_WORKFLOW_SYSTEM_PROMPT });
        for (const h of historyForMultimodal) {
            messages.push({ role: h.role, content: h.content });
        }
        if (workflowContext) {
            messages.push({ role: "system", content: workflowContextText(workflowContext) });
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
    };

    try {
        if (mediaItems.length > 0 && hasVideo && genUrl) {
            try {
                const reply = await callGeminiGenerateContent(multimodalPayload);
                writeSseOpenAiStyleDeltas(res, reply);
                res.end();
                return;
            } catch (genErr: any) {
                console.error("[PromptController] geminiChatStream generate-content（视频）失败:", genErr?.message || genErr);
                res.write(
                    `event: error\ndata: ${JSON.stringify({ message: genErr?.message || "视频识别失败" })}\n\n`
                );
                res.end();
                return;
            }
        }

        if (mediaItems.length > 0 && !hasVideo) {
            try {
                const aceRes = await requestGeminiChatVisionStream(
                    multimodalPayload,
                    API_URL,
                    MODEL,
                    typeof temperature === "number" ? temperature : undefined,
                    typeof maxTokens === "number" ? maxTokens : undefined
                );
                await new Promise<void>((resolve, reject) => {
                    aceRes.data.on("data", (chunk: Buffer) => {
                        res.write(chunk.toString());
                    });
                    aceRes.data.on("end", () => resolve());
                    aceRes.data.on("error", (err: unknown) => reject(err));
                });
                res.end();
                return;
            } catch (streamVisionErr: any) {
                console.warn(
                    "[PromptController] geminiChatStream 图片多模态流式失败，尝试非流式:",
                    streamVisionErr?.message || streamVisionErr
                );
                try {
                    const reply = await callGeminiMultimodal(multimodalPayload);
                    writeSseOpenAiStyleDeltas(res, reply);
                    res.end();
                    return;
                } catch (mmErr: any) {
                    console.error(
                        "[PromptController] geminiChatStream 多模态失败，回退纯文本流式 chat:",
                        mmErr?.message || mmErr
                    );
                }
            }
        }

        await pipeChatCompletionsStream();
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
