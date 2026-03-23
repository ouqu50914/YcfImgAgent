/**
 * 工作流 Gemini：从上下文中的视频 URL 拉取媒体，走 generateContent 多模态（视频 + 文本），
 * 用于「识别视频内容并与 generationContext.connectedPromptText 对比」。
 */
import axios from "axios";
import { getSignedUrl, isCosEnabled, pathToKey, upload } from "./cos.service";

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 与 Gemini 内联建议一致，避免超大请求
const MAX_VIDEOS_PER_REQUEST = 1;
const DEFAULT_REHOST_EXPIRES_SECONDS = 10 * 60; // 10 分钟，够一次识别

const GEMINI_LOG_TEXT_MAX_CHARS = Number(process.env.GEMINI_LOG_TEXT_MAX_CHARS || "2500");

function stringifyGeminiPayloadForLog(payload: unknown): string {
    // 仅用于排查：避免把大段 base64/超长文本打进日志
    return JSON.stringify(payload, (key, value) => {
        if (key === "data" && typeof value === "string") {
            return `<base64_redacted_len=${value.length}>`;
        }
        if (key === "text" && typeof value === "string") {
            if (value.length > GEMINI_LOG_TEXT_MAX_CHARS) {
                return `${value.slice(0, GEMINI_LOG_TEXT_MAX_CHARS)}...TRUNCATED(len=${value.length})`;
            }
        }
        return value;
    });
}

function guessVideoMimeFromUrlByExt(urlStr: string): string {
    const lower = urlStr.toLowerCase();
    if (lower.includes(".mov")) return "video/quicktime";
    if (lower.includes(".webm")) return "video/webm";
    return "video/mp4";
}

async function fetchVideoAsBuffer(url: string, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string }> {
    const resp = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: maxBytes + 1,
        maxBodyLength: maxBytes + 1,
        validateStatus: (s) => s >= 200 && s < 400,
    });
    const buf = Buffer.from(resp.data as ArrayBuffer);
    if (buf.length > maxBytes) {
        throw new Error(`视频过大（>${maxBytes} bytes），请使用较短成片或联系管理员调高限制`);
    }
    const ct = (resp.headers?.["content-type"] as string | undefined) || undefined;
    const mimeType = typeof ct === "string" && ct.trim() ? ct : guessVideoMimeFromUrlByExt(url);
    return { buffer: buf, mimeType };
}

/** 从 workflowContext（前端 Workflow.vue 结构）收集 https 视频 URL；支持 selectedNodes 与 lastClickedNode */
export function extractVideoUrlsFromWorkflowContext(ctx: unknown): string[] {
    const out: string[] = [];
    const add = (u: unknown) => {
        if (typeof u !== "string") return;
        const s = u.trim();
        if (s.startsWith("https://") || s.startsWith("http://")) {
            out.push(s);
        }
    };
    const walkMedia = (m: unknown) => {
        if (!m || typeof m !== "object") return;
        const media = m as Record<string, unknown>;
        if (Array.isArray(media.videoUrls)) {
            for (const u of media.videoUrls) add(u);
        }
    };
    if (!ctx || typeof ctx !== "object") return dedupeLimit(out);
    const o = ctx as Record<string, unknown>;
    if (Array.isArray(o.selectedNodes)) {
        for (const n of o.selectedNodes) {
            if (n && typeof n === "object") walkMedia((n as Record<string, unknown>).media);
        }
    }
    const lastClicked = o.lastClickedNode;
    if (lastClicked && typeof lastClicked === "object") {
        walkMedia((lastClicked as Record<string, unknown>).media);
    }
    return dedupeLimit(out);
}

function dedupeLimit(urls: string[]): string[] {
    const seen = new Set<string>();
    const r: string[] = [];
    for (const u of urls) {
        if (seen.has(u)) continue;
        seen.add(u);
        r.push(u);
        if (r.length >= MAX_VIDEOS_PER_REQUEST) break;
    }
    return r;
}

/**
 * SSRF 防护：未配置则允许任意 http(s)（兼容内网部署）；配置后仅允许列出的主机名后缀。
 * 例：GEMINI_MEDIA_FETCH_ALLOWED_HOSTS=example.com,cdn.example.com
 */
export function isUrlAllowedForMediaFetch(urlStr: string): boolean {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== "https:" && u.protocol !== "http:") return false;
        const raw = process.env.GEMINI_MEDIA_FETCH_ALLOWED_HOSTS || "";
        if (!raw.trim()) return true;
        const hosts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        return hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
    } catch {
        return false;
    }
}

function guessVideoMimeFromUrl(urlStr: string, contentType: string | undefined): string {
    const head = (contentType || "").split(";")[0];
    const ct = (head ?? "").trim().toLowerCase();
    if (ct.startsWith("video/")) return ct;
    const lower = urlStr.toLowerCase();
    if (lower.includes(".webm")) return "video/webm";
    if (lower.includes(".mov")) return "video/quicktime";
    if (lower.includes(".avi")) return "video/x-msvideo";
    return "video/mp4";
}

export async function fetchVideoAsInlineData(
    url: string,
): Promise<{ mimeType: string; base64: string }> {
    if (!isUrlAllowedForMediaFetch(url)) {
        throw new Error("该视频地址不在允许拉取的主机列表中（请配置 GEMINI_MEDIA_FETCH_ALLOWED_HOSTS 或检查 URL）");
    }
    const resp = await axios.get(url, {
        responseType: "arraybuffer",
        maxContentLength: MAX_VIDEO_BYTES + 1,
        maxBodyLength: MAX_VIDEO_BYTES + 1,
        timeout: 120000,
        validateStatus: (s) => s >= 200 && s < 400,
    });
    const buf = Buffer.from(resp.data as ArrayBuffer);
    if (buf.length > MAX_VIDEO_BYTES) {
        throw new Error(`视频过大（>${MAX_VIDEO_BYTES / 1024 / 1024}MB），请使用较短成片或联系管理员调高限制`);
    }
    const mime = guessVideoMimeFromUrl(url, resp.headers["content-type"] as string | undefined);
    return {
        mimeType: mime,
        base64: buf.toString("base64"),
    };
}

export interface GenerateContentWithVideoOptions {
    systemInstruction: string;
    userText: string;
    videoMimeType: string;
    videoBase64: string;
    temperature?: number;
    maxOutputTokens?: number;
}

export interface GenerateContentWithVideoUrlOptions {
    systemInstruction: string;
    userText: string;
    videoUrl: string;
    videoMimeType?: string;
    temperature?: number;
    maxOutputTokens?: number;
}

/**
 * 调用 Gemini generateContent（与 .env 中 GEMINI_GENERATE_CONTENT_API_URL 一致，Ace 代理）。
 */
export async function generateContentWithInlineVideo(
    options: GenerateContentWithVideoOptions,
): Promise<string> {
    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    const API_URL = process.env.GEMINI_GENERATE_CONTENT_API_URL;
    if (!API_KEY || !API_URL) {
        throw new Error(
            "未配置 GEMINI_GENERATE_CONTENT_API_URL 或 GEMINI_CHAT_API_KEY，无法发送视频多模态请求",
        );
    }

    const body: Record<string, unknown> = {
        systemInstruction: {
            parts: [{ text: options.systemInstruction }],
        },
        contents: [
            {
                role: "user",
                parts: [
                    {
                        inline_data: {
                            mime_type: options.videoMimeType,
                            data: options.videoBase64,
                        },
                    },
                    { text: options.userText },
                ],
            },
        ],
        generationConfig: {
            temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
            maxOutputTokens:
                typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
        },
    };

    let response;
    const requestMeta = {
        apiUrl: API_URL,
        hasApiKey: Boolean(API_KEY),
        videoMimeType: options.videoMimeType,
        videoBase64Length: options.videoBase64?.length ?? 0,
        temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
        maxOutputTokens:
            typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
    };
    try {
        response = await axios.post(API_URL, body, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${API_KEY}`,
            },
            timeout: 300000,
            validateStatus: (s) => s < 500,
        });
    } catch (e: unknown) {
        const err = e as { message?: string; response?: { status?: number; data?: unknown } };
        const status = err?.response?.status;
        const detail =
            typeof err?.response?.data === "string"
                ? err.response.data.slice(0, 800)
                : err?.response?.data != null
                  ? JSON.stringify(err.response.data).slice(0, 800)
                  : "";
        console.error(
            "[GeminiMultimodal] 请求异常:",
            err?.message,
            status != null ? `status=${status}` : "",
            detail ? `body=${detail}` : "",
            `meta=${JSON.stringify(requestMeta)}`,
        );
        throw new Error("Gemini 视频多模态网络请求失败，请稍后重试");
    }

    if (response.status >= 400) {
        const detail =
            typeof response.data === "object"
                ? JSON.stringify(response.data).slice(0, 400)
                : String(response.data ?? "").slice(0, 400);
        console.error("[GeminiMultimodal] HTTP", response.status, detail, `meta=${JSON.stringify(requestMeta)}`);
        throw new Error(`Gemini 视频多模态接口返回错误（${response.status}），请检查模型与请求格式`);
    }

    const data = response.data;
    let text: unknown =
        (Array.isArray(data?.candidates) &&
            data.candidates[0]?.content?.parts &&
            Array.isArray(data.candidates[0].content.parts) &&
            data.candidates[0].content.parts.map((p: { text?: string }) => p?.text || "").join("")) ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.text ||
        "";

    if (typeof text !== "string" || !text.trim()) {
        console.error("[GeminiMultimodal] 意外响应:", JSON.stringify(data).slice(0, 500));
        throw new Error("Gemini 视频多模态返回格式异常");
    }
    return text.trim();
}

/**
 * 调用 Gemini generateContent（URL 引用视频，不走内联 base64）。
 * 使用 file_data.file_uri 让上游直接拉取 URL，避免本服务上传超大请求体。
 */
export async function generateContentWithVideoUrl(
    options: GenerateContentWithVideoUrlOptions,
): Promise<string> {
    const API_KEY = process.env.GEMINI_CHAT_API_KEY;
    const API_URL = process.env.GEMINI_GENERATE_CONTENT_API_URL;
    if (!API_KEY || !API_URL) {
        throw new Error(
            "未配置 GEMINI_GENERATE_CONTENT_API_URL 或 GEMINI_CHAT_API_KEY，无法发送视频多模态请求",
        );
    }
    if (!isUrlAllowedForMediaFetch(options.videoUrl)) {
        throw new Error("该视频地址不在允许拉取的主机列表中（请配置 GEMINI_MEDIA_FETCH_ALLOWED_HOSTS 或检查 URL）");
    }

    const body: Record<string, unknown> = {
        systemInstruction: {
            parts: [{ text: options.systemInstruction }],
        },
        contents: [
            {
                role: "user",
                parts: [
                    {
                        // Gemini generateContent 常见 JSON 形态：camelCase（fileData/fileUri/mimeType）
                        fileData: {
                            mimeType: options.videoMimeType || "video/mp4",
                            fileUri: options.videoUrl,
                        },
                    },
                    { text: options.userText },
                ],
            },
        ],
        generationConfig: {
            temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
            maxOutputTokens:
                typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
        },
    };

    let response;
    const requestMeta = {
        apiUrl: API_URL,
        hasApiKey: Boolean(API_KEY),
        videoUrl: options.videoUrl,
        videoMimeType: options.videoMimeType || "video/mp4",
        temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
        maxOutputTokens:
            typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
    };
    const doRequest = async (videoUrlForModel: string, fileMimeType: string) => {
        const body: Record<string, unknown> = {
            systemInstruction: {
                parts: [{ text: options.systemInstruction }],
            },
            contents: [
                {
                    role: "user",
                    parts: [
                        // Gemini generateContent: fileData/fileUri/mimeType（camelCase）
                        {
                            fileData: {
                                mimeType: fileMimeType,
                                fileUri: videoUrlForModel,
                            },
                        },
                        { text: options.userText },
                    ],
                },
            ],
            generationConfig: {
                temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
                maxOutputTokens:
                    typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
            },
        };

        const requestMeta = {
            apiUrl: API_URL,
            hasApiKey: Boolean(API_KEY),
            videoUrl: videoUrlForModel,
            videoMimeType: fileMimeType,
            temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
            maxOutputTokens:
                typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : 8192,
        };

        let r;
        try {
            console.error(
                "[GeminiMultimodal][URL] request debug:",
                stringifyGeminiPayloadForLog({
                    apiUrl: API_URL,
                    headers: { "Content-Type": "application/json" },
                    body,
                    videoUrlForModel,
                    fileMimeType,
                }),
            );
            r = await axios.post(API_URL, body, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${API_KEY}`,
                },
                timeout: 300000,
                validateStatus: (s) => s < 500,
            });
        } catch (e: unknown) {
            const err = e as { message?: string; response?: { status?: number; data?: unknown } };
            const status = err?.response?.status;
            const detail =
                typeof err?.response?.data === "string"
                    ? err.response.data.slice(0, 800)
                    : err?.response?.data != null
                      ? JSON.stringify(err.response.data).slice(0, 800)
                      : "";
            console.error(
                "[GeminiMultimodal][URL] 请求异常:",
                err?.message,
                status != null ? `status=${status}` : "",
                detail ? `body=${detail}` : "",
                `meta=${JSON.stringify(requestMeta)}`,
            );
            throw new Error("Gemini 视频多模态网络请求失败，请稍后重试");
        }

        return { r, requestMeta };
    };

    const initialMimeType = options.videoMimeType || "video/mp4";
    try {
        const req = await doRequest(options.videoUrl, initialMimeType);
        response = req.r;
    } catch (e) {
        throw e;
    }

    // 如果是 Ace 抓取失败（源站对 Ace 不可达），则尝试后端重托管到 COS 再用 COS URL 调一次。
    // 不转 base64，仍保持 URL 引用。
    const errorBodyMaybe =
        typeof response?.data === "object"
            ? JSON.stringify(response.data)
            : String(response?.data ?? "");

    const cannotFetch =
        response?.status === 400 && /Cannot fetch content from the provided URL/i.test(errorBodyMaybe);
    const invalidArgument =
        response?.status === 400 && /invalid argument/i.test(errorBodyMaybe);

    // 对于“有的视频能识别、有的视频不能”的场景：
    // 1) 若 Ace 抓取失败提示 Cannot fetch，则一定重托管到 COS 重试；
    // 2) 若直接返回 invalid argument（常见于较大视频/某些 URL 在 Ace 侧校验失败），也尝试重托管到 COS 再试一次。
    if (cannotFetch || invalidArgument) {
        if (!isCosEnabled()) {
            throw new Error(
                (cannotFetch
                    ? "Ace 抓取源视频失败"
                    : "Ace 校验视频参数失败") +
                "，且当前未启用 COS；请启用 COS 或检查视频 URL 对 Ace 的可访问性/兼容性。",
            );
        }

        // 拉取源视频到内存（仅在小文件/失败时触发）
        const rehostKey = (() => {
            const now = Date.now();
            const rand = Math.random().toString(16).slice(2, 8);
            return `uploads/gemini_video_rehost_${now}_${rand}.mp4`;
        })();

        const rehostMaxBytes = 20 * 1024 * 1024;
        const { buffer, mimeType } = await fetchVideoAsBuffer(options.videoUrl, rehostMaxBytes);
        await upload(rehostKey, buffer, mimeType);

        const signed = await getSignedUrl(pathToKey("/" + rehostKey), DEFAULT_REHOST_EXPIRES_SECONDS);
        if (!signed) {
            throw new Error("COS 预签名 URL 生成失败，无法继续重试。");
        }
        try {
            const host = new URL(signed).host;
            console.error("[GeminiMultimodal][URL] rehost triggered, signedHost=", host);
        } catch {
            console.error("[GeminiMultimodal][URL] rehost triggered");
        }
        // 重托管到 COS 的对象通常是私有的，模型侧拉取依赖签名 query。
        // 因此重试时必须直接使用 signedUrl（不要去掉 query），否则会出现 Cannot fetch content。
        const retryReq = await doRequest(signed, mimeType);
        response = retryReq.r;
    }

    if (response.status >= 400) {
        const detail =
            typeof response.data === "object"
                ? JSON.stringify(response.data).slice(0, 400)
                : String(response.data ?? "").slice(0, 400);
        console.error("[GeminiMultimodal][URL] HTTP", response.status, detail, `meta=${JSON.stringify(requestMeta)}`);
        throw new Error(`Gemini 视频多模态接口返回错误（${response.status}），请检查模型与请求格式`);
    }

    const data = response.data;
    const text: unknown =
        (Array.isArray(data?.candidates) &&
            data.candidates[0]?.content?.parts &&
            Array.isArray(data.candidates[0].content.parts) &&
            data.candidates[0].content.parts.map((p: { text?: string }) => p?.text || "").join("")) ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.text ||
        "";

    if (typeof text !== "string" || !text.trim()) {
        console.error("[GeminiMultimodal][URL] 意外响应:", JSON.stringify(data).slice(0, 500));
        throw new Error("Gemini 视频多模态返回格式异常");
    }
    return text.trim();
}
