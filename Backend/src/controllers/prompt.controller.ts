import { Request, Response } from "express";
import axios from "axios";
import { PromptService } from "../services/prompt.service";
import { LogService } from "../services/log.service";
import {
    extractVideoUrlsFromWorkflowContext,
    generateContentWithVideoUrl,
} from "../services/gemini-multimodal.service";

const promptService = new PromptService();
const logService = new LogService();

/** 工作流上下文 JSON 上限，超出时截断末尾（前端已按需携带详略，此处作兜底） */
const WORKFLOW_CONTEXT_JSON_MAX_CHARS = 100000;


/** 纯文本 chat/completions 与多模态 generateContent 共用的基础说明（多模态时会再追加 VIDEO_MULTIMODAL_SYSTEM_APPEND） */
const GEMINI_TEXT_SYSTEM_FULL =
    "你是一个帮助用户编辑和管理 AI 工作流的智能助手，可以根据用户问题提供建议、解释和操作步骤。" +
    " 工作流上下文采用按需详略：默认仅有 nodesCount、edgesCount、nodesByType、allNodesBrief（id+type）；仅当用户选中节点或最近单击节点时，才会包含 selectedNodes、lastClickedNode 的详细信息（media、generationContext、text 等）。若用户问某节点的具体内容、媒体或提示词对比，而上下文中无该节点详情，请提示用户先在画布上选中或单击目标节点。" +
    " 若上下文含 nodesByType、selectedNodes、lastClickedNode、lastClickedGenerationContext，请据此回答；询问节点数量与类型时以 nodesByType 为准；用户问成片与提示词是否相符时，结合 connectedPromptText 与（若有的）视频内容理解。" +
    " 当你就某 prompt 节点给出具体的提示词修改建议时，请在建议结尾追加（用户不可见）：[WF_UPDATE_PROMPT]{\"nodeId\":\"目标节点 id（用 connectedPromptNodeId 或 selectedNodes/lastClickedNode 中的 prompt id）\",\"newText\":\"建议的新提示词\"}[/WF_UPDATE_PROMPT]。用户回复「确认」「应用」等即自动应用。" +
    " 标签必须严格写成 WF_UPDATE_PROMPT（字母 W 和 F），不要写成 MF_UPDATE_PROMPT。";

const VIDEO_MULTIMODAL_SYSTEM_APPEND =
    " 当本请求附带视频时：你必须基于视频画面与（若有）音频作答。若上下文中存在 generationContext.connectedPromptText、connectedPromptNodeId，请与视频内容逐项对照，说明符合点、差异点、差异程度（大/中/小），并给出可执行的修改建议。若你给出了具体的新提示词建议，请在结尾追加：[WF_UPDATE_PROMPT]{\"nodeId\":\"connectedPromptNodeId 的值\",\"newText\":\"建议的新提示词\"}[/WF_UPDATE_PROMPT]。用户回复「确认」「应用」等即自动应用。" +
    " 标签必须严格写成 WF_UPDATE_PROMPT（字母 W 和 F），不要写成 MF_UPDATE_PROMPT。";

function buildChatHistoryText(history: unknown): string {
    if (!Array.isArray(history) || history.length === 0) return "";
    const lines: string[] = ["【近期对话】"];
    for (const item of history.slice(-10)) {
        if (!item || typeof item !== "object") continue;
        const h = item as { role?: string; content?: string };
        if (typeof h.content !== "string") continue;
        const role = h.role === "assistant" ? "助手" : "用户";
        lines.push(`${role}: ${h.content.slice(0, 4000)}`);
    }
    return lines.join("\n").slice(0, 12000);
}

async function replyWithVideoMultimodal(params: {
    message: string;
    history: unknown;
    workflowContext: unknown;
    temperature?: number;
    maxTokens?: number;
}): Promise<string> {
    const urls = extractVideoUrlsFromWorkflowContext(params.workflowContext);
    if (urls.length === 0) {
        throw new Error("内部错误：未找到可拉取的视频 URL");
    }
    const firstVideoUrl = urls[0];
    if (!firstVideoUrl) {
        throw new Error("内部错误：未找到可拉取的视频 URL");
    }
    const ctxJson = JSON.stringify(params.workflowContext).slice(0, WORKFLOW_CONTEXT_JSON_MAX_CHARS);
    const systemInstruction =
        GEMINI_TEXT_SYSTEM_FULL +
        VIDEO_MULTIMODAL_SYSTEM_APPEND +
        `\n\n当前工作流上下文（JSON）：\n${ctxJson}`;
    const hist = buildChatHistoryText(params.history);
    const userText =
        (hist ? `${hist}\n\n` : "") +
        `【用户本轮问题】\n${params.message}`;
    return generateContentWithVideoUrl({
        systemInstruction,
        userText,
        videoUrl: firstVideoUrl,
        ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
        ...(typeof params.maxTokens === "number" ? { maxOutputTokens: params.maxTokens } : {}),
    });
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

        const videoUrls =
            workflowContext && typeof workflowContext === "object"
                ? extractVideoUrlsFromWorkflowContext(workflowContext)
                : [];

        if (videoUrls.length > 0) {
            if (!process.env.GEMINI_GENERATE_CONTENT_API_URL) {
                return res.status(500).json({
                    message:
                        "已选中带视频的节点，但服务端未配置 GEMINI_GENERATE_CONTENT_API_URL，无法分析视频内容。",
                });
            }
            const reply = await replyWithVideoMultimodal({
                message,
                history,
                workflowContext,
                temperature,
                maxTokens,
            });

            if (userId) {
                const ipAddressRaw = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
                const logOptions: { details?: any; ipAddress?: string } = {
                    details: {
                        type: "gemini-chat-multimodal-video",
                        message,
                        historyLength: Array.isArray(history) ? history.length : 0,
                        workflowContextSummary: workflowContext ? Object.keys(workflowContext as object) : undefined,
                    },
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
                data: { reply },
            });
        }

        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];

        messages.push({
            role: "system",
            content: GEMINI_TEXT_SYSTEM_FULL,
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
                content: `当前工作流上下文信息：${JSON.stringify(workflowContext).slice(0, WORKFLOW_CONTEXT_JSON_MAX_CHARS)}`,
            });
        }

        messages.push({
            role: "user",
            content: message,
        });

        const reply = await promptService.chatWithGemini(messages, {
            temperature,
            maxTokens,
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

    const videoUrls =
        workflowContext && typeof workflowContext === "object"
            ? extractVideoUrlsFromWorkflowContext(workflowContext)
            : [];

    // SSE 头（视频多模态与流式共用）
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    res.flushHeaders && res.flushHeaders();

    if (videoUrls.length > 0) {
        if (!process.env.GEMINI_GENERATE_CONTENT_API_URL) {
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message:
                        "已选中带视频的节点，但服务端未配置 GEMINI_GENERATE_CONTENT_API_URL，无法分析视频内容。",
                })}\n\n`,
            );
            res.end();
            return;
        }
        try {
            const reply = await replyWithVideoMultimodal({
                message,
                history,
                workflowContext,
                temperature,
                maxTokens,
            });
            const payload = JSON.stringify({ choices: [{ delta: { content: reply } }] });
            res.write(`data: ${payload}\n\n`);
            res.end();
            return;
        } catch (error: any) {
            console.error("[PromptController] geminiChatStream multimodal error:", error?.message || error);
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    message: error?.message || "视频多模态分析失败",
                })}\n\n`,
            );
            res.end();
            return;
        }
    }

    const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];

    messages.push({
        role: "system",
        content: GEMINI_TEXT_SYSTEM_FULL,
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
            content: `当前工作流上下文信息：${JSON.stringify(workflowContext).slice(0, WORKFLOW_CONTEXT_JSON_MAX_CHARS)}`,
        });
    }

    messages.push({
        role: "user",
        content: message,
    });

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
        const status = error?.response?.status;
        const detail =
            typeof error?.response?.data === "string"
                ? error.response.data.slice(0, 500)
                : error?.response?.data != null
                  ? JSON.stringify(error.response.data).slice(0, 500)
                  : "";
        console.error(
            "[PromptController] geminiChatStream request error:",
            error?.message || error,
            status != null ? `status=${status}` : "",
            detail ? `body=${detail}` : "",
        );
        const clientMsg =
            status === 502 || status === 503 || status === 504
                ? `上游聊天接口不可用或网关错误（HTTP ${status}），请稍后重试或检查 GEMINI_CHAT_API_URL / 网络与配额`
                : error?.message || "Gemini 流式调用失败";
        res.write(`event: error\ndata: ${JSON.stringify({ message: clientMsg })}\n\n`);
        res.end();
    }
};
