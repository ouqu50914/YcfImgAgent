import axios from "axios";
import { extractVideoKeyFramesJpeg, isFfmpegVideoFramesEnabled } from "../utils/video-frames-ffmpeg";
import { ErrorLogService } from "./error-log.service";
import { getRequestTraceId } from "../utils/request-trace";
import { normalizeProviderError } from "../errors/normalize-provider-error";

const geminiErrorLog = new ErrorLogService();

const MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_URLS = 8;
const MAX_VIDEO_URLS = 2;
const MAX_AUDIO_URLS = 2;
const MAX_HISTORY_TURNS = 8;
const FETCH_TIMEOUT_MS = 60000;

const GEMINI_GENERATE_CONTENT_TIMEOUT_MS = 300000;

/** 设为 false 可关闭详细请求日志；未设置时默认打印（便于排查，生产环境可关闭） */
function shouldLogGeminiRequestDetail(): boolean {
    return process.env.GEMINI_DEBUG_LOG_REQUESTS !== "false";
}

const MAX_LOG_TEXT_CHARS = 6000;
const MAX_LOG_BASE64_PREFIX = 160;

/**
 * 脱敏：截断超长 text/base64，缩短 fileUri，避免控制台被撑爆
 */
function redactBodyForLog(value: unknown, depth = 0): unknown {
    if (depth > 20) return "[max depth]";
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
        if (value.length > MAX_LOG_TEXT_CHARS) {
            return `${value.slice(0, MAX_LOG_TEXT_CHARS)}…(字符串长度=${value.length})`;
        }
        return value;
    }
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) {
        return value.map((v) => redactBodyForLog(v, depth + 1));
    }
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
        if (k === "data" && typeof v === "string") {
            out[k] =
                v.length > MAX_LOG_BASE64_PREFIX
                    ? `${v.slice(0, MAX_LOG_BASE64_PREFIX)}…(base64 长度=${v.length})`
                    : v;
            continue;
        }
        if (k === "fileUri" && typeof v === "string" && v.length > 240) {
            out[k] = `${v.slice(0, 240)}…(长度=${v.length})`;
            continue;
        }
        out[k] = redactBodyForLog(v, depth + 1);
    }
    return out;
}

function maskBearerToken(token: string): string {
    if (!token || token.length < 6) return "Bearer ***";
    return `Bearer ***${token.slice(-4)}`;
}

function logGenerateContentRequest(
    resolvedUrl: string,
    body: Record<string, unknown>,
    apiKey: string,
    extra?: { modelInPath: boolean; rawContentsCount: number }
): void {
    if (!shouldLogGeminiRequestDetail()) return;

    const safeBody = redactBodyForLog(body) as Record<string, unknown>;
    console.log(
        "[GeminiMultimodal][DEBUG] generateContent 请求详情\n" +
            "---\n" +
            `method: POST\n` +
            `url: ${resolvedUrl}\n` +
            `timeoutMs: ${GEMINI_GENERATE_CONTENT_TIMEOUT_MS}\n` +
            (extra
                ? `modelInPath(v1beta): ${extra.modelInPath}\nrawContents条数(转换前): ${extra.rawContentsCount}\n`
                : "") +
            "headers: " +
            JSON.stringify(
                {
                    "Content-Type": "application/json",
                    Authorization: maskBearerToken(apiKey),
                },
                null,
                2
            ) +
            "\n" +
            "body (脱敏/截断后 JSON):\n" +
            JSON.stringify(safeBody, null, 2) +
            "\n---"
    );
}

function logGenerateContentResponseOk(status: number, data: unknown): void {
    if (!shouldLogGeminiRequestDetail()) return;
    const preview =
        typeof data === "string"
            ? data.slice(0, 1200)
            : JSON.stringify(data ?? null, null, 2).slice(0, 4000);
    console.log(
        `[GeminiMultimodal][DEBUG] generateContent 响应 OK status=${status}\n` +
            "data (截断预览):\n" +
            preview +
            (preview.length >= 4000 ? "\n…(已截断)" : "")
    );
}

export type WorkflowMediaItem = { url: string; kind: "image" | "video" | "audio" };

function isHttpUrl(s: string): boolean {
    const t = s.trim();
    return t.startsWith("https://") || t.startsWith("http://");
}

/**
 * 从 workflowContext.selectedNodes[].media 收集图片、视频 URL（与前端约定一致）
 */
export function extractWorkflowMediaUrls(workflowContext: unknown): WorkflowMediaItem[] {
    const ctx = workflowContext as { selectedNodes?: unknown } | null | undefined;
    const sel = ctx?.selectedNodes;
    if (!Array.isArray(sel)) return [];

    const images: string[] = [];
    const videos: string[] = [];
    const audios: string[] = [];

    for (const n of sel) {
        const m = (n as {
            media?: { imageUrls?: unknown; videoUrls?: unknown; audioUrls?: unknown };
        })?.media;
        if (!m || typeof m !== "object") continue;
        if (Array.isArray(m.imageUrls)) {
            for (const u of m.imageUrls) {
                if (typeof u === "string" && isHttpUrl(u)) images.push(u.trim());
            }
        }
        if (Array.isArray(m.videoUrls)) {
            for (const u of m.videoUrls) {
                if (typeof u === "string" && isHttpUrl(u)) videos.push(u.trim());
            }
        }
        if (Array.isArray(m.audioUrls)) {
            for (const u of m.audioUrls) {
                if (typeof u === "string" && isHttpUrl(u)) audios.push(u.trim());
            }
        }
    }

    const dedupe = (arr: string[]) => [...new Set(arr)];
    const out: WorkflowMediaItem[] = [];
    for (const url of dedupe(images).slice(0, MAX_IMAGE_URLS)) {
        out.push({ url, kind: "image" });
    }
    for (const url of dedupe(videos).slice(0, MAX_VIDEO_URLS)) {
        out.push({ url, kind: "video" });
    }
    for (const url of dedupe(audios).slice(0, MAX_AUDIO_URLS)) {
        out.push({ url, kind: "audio" });
    }
    return out;
}

function guessImageMimeFromUrl(url: string): string {
    const lower = (url.split("?")[0] ?? url).toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    return "image/jpeg";
}

function guessVideoMimeFromUrl(url: string): string {
    const lower = (url.split("?")[0] ?? url).toLowerCase();
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".mp4")) return "video/mp4";
    return "video/mp4";
}

function guessAudioMimeFromUrl(url: string): string {
    const lower = (url.split("?")[0] ?? url).toLowerCase();
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".m4a")) return "audio/mp4";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    return "audio/mpeg";
}

/**
 * 为 Ace Gemini Generate Content 构建 parts：图片尽量 inline_data（本机拉取），视频用 file_uri（避免超大内存）
 */
export async function buildMediaPartsForGenerateContent(
    items: WorkflowMediaItem[]
): Promise<Record<string, unknown>[]> {
    const parts: Record<string, unknown>[] = [];

    for (const item of items) {
        if (item.kind === "video") {
            parts.push({
                file_data: {
                    mime_type: guessVideoMimeFromUrl(item.url),
                    file_uri: item.url,
                },
            });
            continue;
        }

        if (item.kind === "audio") {
            parts.push({
                file_data: {
                    mime_type: guessAudioMimeFromUrl(item.url),
                    file_uri: item.url,
                },
            });
            continue;
        }

        try {
            const res = await axios.get(item.url, {
                responseType: "arraybuffer",
                timeout: FETCH_TIMEOUT_MS,
                maxContentLength: MAX_INLINE_IMAGE_BYTES,
                maxBodyLength: MAX_INLINE_IMAGE_BYTES,
                validateStatus: (status) => status === 200,
            });

            const buf = Buffer.from(res.data as ArrayBuffer);
            if (buf.length > 0 && buf.length <= MAX_INLINE_IMAGE_BYTES) {
                const headerMime = (res.headers["content-type"] as string | undefined)
                    ?.split(";")[0]
                    ?.trim();
                const mime =
                    headerMime && headerMime.startsWith("image/") ? headerMime : guessImageMimeFromUrl(item.url);
                parts.push({
                    inline_data: {
                        mime_type: mime,
                        data: buf.toString("base64"),
                    },
                });
            } else {
                parts.push({
                    file_data: {
                        mime_type: guessImageMimeFromUrl(item.url),
                        file_uri: item.url,
                    },
                });
            }
        } catch (e: any) {
            console.warn(
                "[GeminiMultimodal] 图片拉取失败，改用 file_uri:",
                item.url.slice(0, 120),
                e?.message || e
            );
            parts.push({
                file_data: {
                    mime_type: guessImageMimeFromUrl(item.url),
                    file_uri: item.url,
                },
            });
        }
    }

    return parts;
}

type HistoryItem = { role: "user" | "assistant"; content: string };

export interface GeminiGenerateContentParams {
    systemAndContextText: string;
    userMessage: string;
    history: HistoryItem[];
    mediaItems: WorkflowMediaItem[];
    temperature?: number;
    maxOutputTokens?: number;
}

/**
 * 仅当 GEMINI_VIDEO_USE_FFMPEG=true 时：把视频截成多帧 JPEG，走 chat/completions。
 * 默认不执行：视频应使用 Generate Content（file_uri），见 Ace 文档。
 */
async function prepareChatVisionParams(
    params: GeminiGenerateContentParams
): Promise<GeminiGenerateContentParams> {
    if (!isFfmpegVideoFramesEnabled() || !params.mediaItems.some((m) => m.kind === "video")) {
        return params;
    }

    let extra = "";
    const next: WorkflowMediaItem[] = [];

    for (const it of params.mediaItems) {
        if (it.kind !== "video") {
            next.push(it);
            continue;
        }
        const frames = extractVideoKeyFramesJpeg(it.url);
        if (frames.length === 0) {
            next.push(it);
            continue;
        }
        const short = it.url.length > 96 ? `${it.url.slice(0, 96)}…` : it.url;
        extra += `\n【视频关键帧】已从「${short}」截取 ${frames.length} 张按时间顺序的关键帧；请根据这些画面概括视频内容、场景与动作。\n`;
        for (const buf of frames) {
            next.push({
                kind: "image",
                url: `data:image/jpeg;base64,${buf.toString("base64")}`,
            });
        }
    }

    if (!extra) {
        return params;
    }

    return {
        ...params,
        mediaItems: next,
        userMessage: params.userMessage + extra,
    };
}

function parseChatCompletionReply(data: unknown): string {
    const d = data as Record<string, unknown> | null;
    if (!d) return "";

    const choices = d.choices as unknown[] | undefined;
    const ch0 = choices?.[0] as Record<string, unknown> | undefined;
    let content: unknown = ch0?.message
        ? (ch0.message as Record<string, unknown>).content
        : ch0?.text;

    if (typeof content === "string") return content.trim();

    if (Array.isArray(content)) {
        const texts = content
            .map((p) => {
                if (!p || typeof p !== "object") return "";
                const o = p as Record<string, unknown>;
                if (typeof o.text === "string") return o.text;
                return "";
            })
            .filter(Boolean);
        if (texts.length) return texts.join("\n").trim();
    }

    const reply = d.reply ?? d.message ?? d.text;
    if (typeof reply === "string" && reply.trim()) return reply.trim();

    return "";
}

/**
 * Ace 文档示例：POST https://api.acedata.cloud/v1beta/models/{model}:generateContent
 * 模型在 URL 路径里，不在 JSON body 的 model 字段。
 */
function resolveGenerateContentUrl(rawUrl: string, model: string): string {
    const m = model.trim();
    if (!m) return rawUrl;
    return rawUrl.replace(/\{model\}/gi, m);
}

/** 是否为 Google REST 风格（路径含 :generateContent 或 v1beta/models） */
function isGoogleRestGenerateContentUrl(url: string): boolean {
    return /:generateContent\b/i.test(url) || /\/v1beta\/models\//i.test(url);
}

function convertPartToGoogleRest(part: Record<string, unknown>): Record<string, unknown> | null {
    if (typeof part.text === "string") {
        if (!part.text.trim()) return null;
        return { text: part.text };
    }
    const inline = part.inline_data as { mime_type?: string; data?: string } | undefined;
    if (inline && typeof inline.data === "string" && inline.data.length > 0) {
        return {
            inlineData: {
                mimeType: inline.mime_type || "image/jpeg",
                data: inline.data,
            },
        };
    }
    const file = part.file_data as { mime_type?: string; file_uri?: string } | undefined;
    if (file && typeof file.file_uri === "string" && file.file_uri.length > 0) {
        return {
            fileData: {
                mimeType: file.mime_type || "application/octet-stream",
                fileUri: file.file_uri,
            },
        };
    }
    return null;
}

function convertContentsToGoogleRest(contents: Record<string, unknown>[]): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const c of contents) {
        const role = c.role === "model" ? "model" : "user";
        const rawParts = (Array.isArray(c.parts) ? c.parts : []) as Record<string, unknown>[];
        const parts = rawParts
            .map((p) => convertPartToGoogleRest(p))
            .filter((p): p is Record<string, unknown> => p != null);
        if (parts.length === 0) continue;
        out.push({ role, parts });
    }
    return out;
}

function parseGenerateContentReply(data: unknown): string {
    const d = data as Record<string, unknown> | null;
    if (!d) return "";

    const candidates = d.candidates as unknown[] | undefined;
    if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object") {
        const c0 = candidates[0] as Record<string, unknown>;
        const content = c0.content as Record<string, unknown> | undefined;
        const parts = content?.parts as unknown[] | undefined;
        if (Array.isArray(parts)) {
            const texts = parts
                .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).text : undefined))
                .filter((t): t is string => typeof t === "string");
            if (texts.length) return texts.join("\n").trim();
        }
    }

    const reply = d.reply ?? d.message ?? d.text;
    if (typeof reply === "string" && reply.trim()) return reply.trim();

    return "";
}

/**
 * Ace「Chat Completions」：OpenAI 兼容的 content 数组（text + image_url）。
 * 仅用于图片；视频请走 Generate Content（见 callGeminiMultimodal）。
 */
export async function callGeminiChatCompletionsWithVision(
    params: GeminiGenerateContentParams,
    chatApiUrl: string,
    model: string
): Promise<string> {
    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    if (!API_KEY) {
        throw new Error("Gemini 服务未配置 GEMINI_CHAT_API_KEY");
    }

    const prepared = await prepareChatVisionParams(params);

    const messages: Record<string, unknown>[] = [{ role: "system", content: prepared.systemAndContextText }];

    const recent = prepared.history.slice(-MAX_HISTORY_TURNS);
    for (const h of recent) {
        messages.push({ role: h.role, content: h.content });
    }

    const imageItems = prepared.mediaItems.filter((m) => m.kind === "image");
    const otherItems = prepared.mediaItems.filter((m) => m.kind !== "image");

    let textPart = prepared.userMessage;
    if (otherItems.length > 0) {
        textPart +=
            "\n\n【音视频链接（当前经 chat/completions 仅对图片做多模态；以下为 URL 文本）】\n" +
            otherItems.map((m) => `- ${m.kind}: ${m.url}`).join("\n");
    }

    const userContent: Record<string, unknown>[] = [{ type: "text", text: textPart }];
    for (const img of imageItems) {
        userContent.push({ type: "image_url", image_url: { url: img.url } });
    }

    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = { model, messages };
    if (typeof prepared.temperature === "number") body.temperature = prepared.temperature;
    if (typeof prepared.maxOutputTokens === "number") body.max_tokens = prepared.maxOutputTokens;

    try {
        const response = await axios.post(chatApiUrl, body, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${API_KEY}`,
            },
            timeout: 300000,
        });

        const reply = parseChatCompletionReply(response.data);
        if (!reply) {
            throw new Error("Gemini chat 多模态返回内容为空");
        }
        return reply;
    } catch (err: any) {
        const status = err?.response?.status;
        const bodyPreview =
            typeof err?.response?.data === "string"
                ? err.response.data.slice(0, 400)
                : JSON.stringify(err?.response?.data ?? "").slice(0, 400);
        console.error("[GeminiMultimodal] chat/completions 多模态请求失败", {
            url: chatApiUrl,
            status,
            bodyPreview,
        });
        throw err;
    }
}

/**
 * 发起 chat/completions 流式请求（多模态 user content），用于透传 Ace 的 SSE
 */
export async function requestGeminiChatVisionStream(
    params: GeminiGenerateContentParams,
    chatApiUrl: string,
    model: string,
    temperature?: number,
    maxTokens?: number
) {
    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    if (!API_KEY) {
        throw new Error("Gemini 服务未配置 GEMINI_CHAT_API_KEY");
    }

    const prepared = await prepareChatVisionParams(params);

    const messages: Record<string, unknown>[] = [{ role: "system", content: prepared.systemAndContextText }];

    const recent = prepared.history.slice(-MAX_HISTORY_TURNS);
    for (const h of recent) {
        messages.push({ role: h.role, content: h.content });
    }

    const imageItems = prepared.mediaItems.filter((m) => m.kind === "image");
    const otherItems = prepared.mediaItems.filter((m) => m.kind !== "image");

    let textPart = prepared.userMessage;
    if (otherItems.length > 0) {
        textPart +=
            "\n\n【音视频链接（当前经 chat/completions 仅对图片做多模态；以下为 URL 文本）】\n" +
            otherItems.map((m) => `- ${m.kind}: ${m.url}`).join("\n");
    }

    const userContent: Record<string, unknown>[] = [{ type: "text", text: textPart }];
    for (const img of imageItems) {
        userContent.push({ type: "image_url", image_url: { url: img.url } });
    }

    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        ...(typeof temperature === "number" ? { temperature } : {}),
        ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {}),
    };

    return axios.post(chatApiUrl, body, {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
        },
        responseType: "stream",
        timeout: 300000,
    });
}

/**
 * 多模态入口（与 [Ace Generate Content 文档](https://platform.acedata.cloud/documents/gemini-generate-content-api) 一致）：
 * - **含视频**：仅使用 `generate-content`，parts 中带 `file_data.file_uri`（整段视频），需配置 `GEMINI_GENERATE_CONTENT_API_URL`（从文档/控制台复制完整 POST 地址）。
 * - **仅图片（无视频）**：`chat/completions` + image_url。
 * - 可选：`GEMINI_VIDEO_USE_FFMPEG=true` 时仍可将视频截帧走 chat（不推荐，与「原生视频」二选一思路）。
 */
export async function callGeminiMultimodal(params: GeminiGenerateContentParams): Promise<string> {
    const chatUrl = process.env.GEMINI_CHAT_API_URL?.trim();
    const genUrl = process.env.GEMINI_GENERATE_CONTENT_API_URL?.trim();
    const model = (process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash").trim();

    if (!chatUrl) {
        throw new Error("未配置 GEMINI_CHAT_API_URL");
    }

    const hasVideo = params.mediaItems.some((m) => m.kind === "video");

    if (hasVideo) {
        if (!genUrl) {
            throw new Error(
                "视频识别需配置 GEMINI_GENERATE_CONTENT_API_URL。请打开 Ace 文档「Gemini Generate Content API」复制网关上的完整接口地址：" +
                    "https://platform.acedata.cloud/documents/gemini-generate-content-api"
            );
        }
        return await callGeminiGenerateContent(params);
    }

    try {
        return await callGeminiChatCompletionsWithVision(params, chatUrl, model);
    } catch (chatErr: any) {
        if (genUrl) {
            console.warn(
                "[GeminiMultimodal] chat 多模态失败，回退 generate-content:",
                chatErr?.message || chatErr
            );
            return await callGeminiGenerateContent(params);
        }
        throw chatErr;
    }
}

/**
 * 调用 Ace Data Gemini Generate Content（多模态，可选）
 * 需在 .env 中设置 GEMINI_GENERATE_CONTENT_API_URL（值从 Ace 文档页复制，勿猜测路径；文档：https://platform.acedata.cloud/documents/gemini-generate-content-api ）
 * - GEMINI_GENERATE_CONTENT_MODEL（可选）
 */
export async function callGeminiGenerateContent(params: GeminiGenerateContentParams): Promise<string> {
    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    const API_URL = process.env.GEMINI_GENERATE_CONTENT_API_URL?.trim();
    const MODEL =
        process.env.GEMINI_GENERATE_CONTENT_MODEL ||
        process.env.GEMINI_CHAT_MODEL ||
        "gemini-1.5-flash-latest";

    if (!API_KEY) {
        throw new Error("Gemini 服务未配置 GEMINI_CHAT_API_KEY");
    }

    if (!API_URL) {
        throw new Error("未配置 GEMINI_GENERATE_CONTENT_API_URL，无法使用 generate-content 回退");
    }

    const mediaParts = await buildMediaPartsForGenerateContent(params.mediaItems);

    const contents: Record<string, unknown>[] = [];

    const recent = params.history.slice(-MAX_HISTORY_TURNS);
    for (const h of recent) {
        const text = typeof h.content === "string" ? h.content.trim() : "";
        if (!text) continue;
        const role = h.role === "assistant" ? "model" : "user";
        contents.push({
            role,
            parts: [{ text }],
        });
    }

    const finalText =
        `${params.systemAndContextText}\n\n` +
        `【用户当前输入】\n${params.userMessage}\n\n` +
        (mediaParts.length
            ? "（若上方包含图片或视频数据，请结合这些媒体内容回答；需要搭建生成管线时仍遵守 JSON 指令约定。）"
            : "");

    contents.push({
        role: "user",
        parts: [{ text: finalText }, ...mediaParts],
    });

    const resolvedUrl = resolveGenerateContentUrl(API_URL, MODEL);
    const modelInPath = isGoogleRestGenerateContentUrl(resolvedUrl);

    /** v1beta/.../:generateContent 必须用 Google REST JSON：inlineData、fileData、generationConfig（camelCase）。snake_case 会导致 400 oneof data */
    const buildSnakeCaseBody = (): Record<string, unknown> => {
        const b: Record<string, unknown> = { contents };
        if (!modelInPath) {
            b.model = MODEL;
        }
        if (typeof params.temperature === "number") {
            b.generation_config = {
                temperature: params.temperature,
                ...(typeof params.maxOutputTokens === "number"
                    ? { max_output_tokens: params.maxOutputTokens }
                    : {}),
            };
        } else if (typeof params.maxOutputTokens === "number") {
            b.generation_config = { max_output_tokens: params.maxOutputTokens };
        }
        return b;
    };

    const buildGoogleRestBody = (): Record<string, unknown> => {
        const converted = convertContentsToGoogleRest(contents);
        if (converted.length === 0) {
            throw new Error("generate-content：有效 contents 为空（请检查对话历史与媒体）");
        }
        const b: Record<string, unknown> = {
            contents: converted,
        };
        const gc: Record<string, unknown> = {};
        if (typeof params.temperature === "number") gc.temperature = params.temperature;
        if (typeof params.maxOutputTokens === "number") gc.maxOutputTokens = params.maxOutputTokens;
        if (Object.keys(gc).length > 0) {
            b.generationConfig = gc;
        }
        return b;
    };

    const body = modelInPath ? buildGoogleRestBody() : buildSnakeCaseBody();

    logGenerateContentRequest(resolvedUrl, body, API_KEY, {
        modelInPath,
        rawContentsCount: contents.length,
    });

    try {
        const response = await axios.post(resolvedUrl, body, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${API_KEY}`,
            },
            timeout: GEMINI_GENERATE_CONTENT_TIMEOUT_MS,
        });

        logGenerateContentResponseOk(response.status, response.data);

        const reply = parseGenerateContentReply(response.data);
        if (!reply) {
            throw new Error("Gemini generate-content 返回格式异常或内容为空");
        }
        return reply;
    } catch (err: any) {
        if (shouldLogGeminiRequestDetail()) {
            console.log(
                "[GeminiMultimodal][DEBUG] generateContent 失败时对照用 body（脱敏）:\n" +
                    JSON.stringify(redactBodyForLog(body), null, 2)
            );
        }
        const status = err?.response?.status;
        const raw = err?.response?.data;
        let bodyPreview = "";
        if (Buffer.isBuffer(raw)) {
            bodyPreview = raw.toString("utf8").slice(0, 500);
        } else if (typeof raw === "string") {
            bodyPreview = raw.slice(0, 500);
        } else {
            bodyPreview = JSON.stringify(raw ?? "").slice(0, 500);
        }
        console.error("[GeminiMultimodal] generate-content 请求失败", {
            url: resolvedUrl,
            status,
            statusText: err?.response?.statusText,
            bodyPreview: bodyPreview || "(empty)",
            axiosCode: err?.code,
            axiosMessage: err?.message,
            requestUrl: err?.config?.url,
        });

        const norm = normalizeProviderError({
            provider: "gemini",
            rawMessage: bodyPreview || err?.message || "",
            ...(typeof status === "number" ? { httpStatus: status } : {}),
        });
        geminiErrorLog.record({
            traceId: getRequestTraceId(),
            errorKey: norm.errorKey,
            messageZh: norm.messageZh,
            messageRaw: (bodyPreview || err?.message || "").slice(0, 2048),
            httpStatus: typeof status === "number" ? status : 500,
            source: "adapter",
            provider: "gemini",
            numericCode: norm.numericCode,
            category: norm.category,
        });

        if (status === 400) {
            throw new Error(
                `generate-content 返回 400：${bodyPreview || err?.message || "请求体与网关要求不符"}`
            );
        }
        if (status === 404) {
            throw new Error(
                `generate-content 返回 404：当前地址在网关上不存在（${API_URL}）。` +
                    " 视频理解可依赖本机 ffmpeg 截关键帧 + chat/completions；或向 Ace 索取可用的 generate-content 地址。"
            );
        }
        if (status === 502) {
            throw new Error(
                "Ace generate-content 返回 502（网关/上游异常）。请检查：1) 视频 URL 是否公网可访问；2) 文件是否过大导致上游超时；3) 联系 Ace 支持或稍后重试。"
            );
        }
        throw err;
    }
}
