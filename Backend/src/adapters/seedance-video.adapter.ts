import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { isCosEnabled, upload as cosUpload, pathToKey } from "../services/cos.service";

const axiosClient = axios.create({ proxy: false });

export interface SeedanceCreateVideoPayload {
    model?: string;
    content: Array<
        | { type: "text"; text: string }
        | {
              type: "image_url";
              image_url: { url: string };
              role?: "first_frame" | "last_frame" | "reference_image";
          }
        | {
              type: "video_url";
              video_url: { url: string };
              role?: "reference_video";
          }
        | {
              type: "audio_url";
              audio_url: { url: string };
              role?: "reference_audio";
          }
    >;
    generate_audio?: boolean;
    ratio?: "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive" | string;
    duration?: number; // 4-15 或 -1
    resolution?: "480p" | "720p" | "1080p" | string;
    watermark?: boolean;
    tools?: Array<{ type: "web_search" | string }>;
}

export interface SeedanceCreateVideoResult {
    id: string;
    task_id: string;
    status: string;
    progress?: number;
    created_at?: number;
}

export type SeedanceTaskStatus =
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "unknown";

export interface SeedanceGetVideoResult {
    raw: any;
    status: SeedanceTaskStatus;
    progress?: string | number | null;
    videoUrl?: string | null;
    duration?: number | null;
    ratio?: string | null;
    resolution?: string | null;
    errorMessage?: string | null;
}

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} 环境变量未配置，请在 Backend/.env 或 .env.local 中配置 Seedance 相关参数`);
    }
    return value;
}

function getBaseUrl(): string {
    const env = process.env.SEEDANCE_BASE_URL ?? "https://www.anyfast.ai";
    return env.replace(/\/$/, "");
}

export type SeedanceActionType =
    | "text"
    | "image_first_frame"
    | "image_first_last"
    | "multi_modal";

export interface SeedanceAdvancedInputBase {
    prompt: string;
    ratio?: string;
    duration?: number;
    resolution?: string;
    generateAudio?: boolean;
    enableWebSearch?: boolean;
}

export interface SeedanceAdvancedInput extends SeedanceAdvancedInputBase {
    action: SeedanceActionType;
    firstImageUrl?: string;
    lastImageUrl?: string;
    referenceImageUrls?: string[];
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
}

export class SeedanceVideoAdapter {
    private getApiKey(): string {
        return getRequiredEnv("SEEDANCE_API_KEY");
    }

    private getDefaultModel(): string {
        return process.env.SEEDANCE_MODEL || "seedance";
    }

    private getDefaultResolution(): string {
        return process.env.SEEDANCE_DEFAULT_RESOLUTION || "720p";
    }

    private getDefaultRatio(): string {
        return process.env.SEEDANCE_DEFAULT_RATIO || "adaptive";
    }

    private getDefaultDuration(): number {
        const raw = process.env.SEEDANCE_DEFAULT_DURATION;
        const n = raw ? Number(raw) : 5;
        if (Number.isNaN(n)) return 5;
        return n;
    }

    private getHeaders() {
        return {
            Authorization: `Bearer ${this.getApiKey()}`,
            "Content-Type": "application/json",
        };
    }

    /**
     * 根据提示词中的别名（@图1/@视频1/@音频1）和实际参考资源数量，补充一段“别名说明”到提示词前面，
     * 以便 Seedance 能更好地理解多模态参考与别名之间的对应关系。
     *
     * 规则与图片生成（DreamAdapter.buildPromptWithAliases）保持一致，并扩展到视频/音频：
     * - 图N   -> 第 N 张参考图片
     * - 视频N -> 第 N 个参考视频
     * - 音频N -> 第 N 个参考音频
     */
    private buildPromptWithMediaAliases(
        originalPrompt: string,
        imageCount: number,
        videoCount: number,
        audioCount: number
    ): string {
        const base = originalPrompt || "生成视频";
        const hasImages = imageCount > 0;
        const hasVideos = videoCount > 0;
        const hasAudios = audioCount > 0;
        if (!hasImages && !hasVideos && !hasAudios) return base;

        // 图片别名
        const imageUsed = new Set<number>();
        if (hasImages) {
            const imgRegex = /@图(\d+)/g;
            let m: RegExpExecArray | null;
            while ((m = imgRegex.exec(base)) !== null) {
                const raw = m[1];
                if (!raw) continue;
                const n = parseInt(raw, 10);
                if (Number.isNaN(n) || n < 1 || n > imageCount) continue;
                imageUsed.add(n);
            }
            if (imageUsed.size === 0) {
                for (let i = 1; i <= imageCount; i++) imageUsed.add(i);
            }
        }

        // 视频别名
        const videoUsed = new Set<number>();
        if (hasVideos) {
            const vidRegex = /@视频(\d+)/g;
            let m: RegExpExecArray | null;
            while ((m = vidRegex.exec(base)) !== null) {
                const raw = m[1];
                if (!raw) continue;
                const n = parseInt(raw, 10);
                if (Number.isNaN(n) || n < 1 || n > videoCount) continue;
                videoUsed.add(n);
            }
            if (videoUsed.size === 0) {
                for (let i = 1; i <= videoCount; i++) videoUsed.add(i);
            }
        }

        // 音频别名
        const audioUsed = new Set<number>();
        if (hasAudios) {
            const audRegex = /@音频(\d+)/g;
            let m: RegExpExecArray | null;
            while ((m = audRegex.exec(base)) !== null) {
                const raw = m[1];
                if (!raw) continue;
                const n = parseInt(raw, 10);
                if (Number.isNaN(n) || n < 1 || n > audioCount) continue;
                audioUsed.add(n);
            }
            if (audioUsed.size === 0) {
                for (let i = 1; i <= audioCount; i++) audioUsed.add(i);
            }
        }

        const descParts: string[] = [];
        if (imageUsed.size > 0) {
            const part = Array.from(imageUsed)
                .sort((a, b) => a - b)
                .map((n) => `图${n} 对应第 ${n} 张参考图片`)
                .join("；");
            descParts.push(part);
        }
        if (videoUsed.size > 0) {
            const part = Array.from(videoUsed)
                .sort((a, b) => a - b)
                .map((n) => `视频${n} 对应第 ${n} 个参考视频`)
                .join("；");
            descParts.push(part);
        }
        if (audioUsed.size > 0) {
            const part = Array.from(audioUsed)
                .sort((a, b) => a - b)
                .map((n) => `音频${n} 对应第 ${n} 个参考音频`)
                .join("；");
            descParts.push(part);
        }

        const aliasDesc = descParts.join("；");
        return `有多种参考资源：${aliasDesc}。下面是用户的详细描述：${base}`;
    }

    /**
     * 尝试从 Seedance 的错误响应中解析出更友好的错误信息与错误码。
     * 部分接口会把真正的错误 JSON 字符串放在 data.message 里，需要额外解析。
     */
    private parseSeedanceError(data: any): { friendlyMessage: string; innerCode?: string } {
        if (!data) {
            return { friendlyMessage: "Seedance 接口调用失败，请稍后重试。" };
        }

        let rawMessage: string | undefined;
        if (typeof data === "string") {
            rawMessage = data;
        } else if (typeof data === "object") {
            rawMessage = (data as any).message || (data as any).error;
        }

        if (!rawMessage) {
            return { friendlyMessage: "Seedance 接口调用失败，请稍后重试。" };
        }

        // 有些场景下 message 本身是一个 JSON 字符串，形如：
        // {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"...","type":"BadRequest"}}
        try {
            const parsed = JSON.parse(rawMessage);
            const innerError = (parsed as any).error;
            const innerCode = innerError?.code as string | undefined;
            const innerMsg = innerError?.message as string | undefined;

            if (innerCode === "InputImageSensitiveContentDetected.PrivacyInformation") {
                // 输入图片包含真人/隐私信息，被 Seedance 拒绝，属于用户侧可读错误
                const requestId = (innerError as any)?.requestId || (innerError as any)?.request_id;
                const suffix = requestId ? `（请求 ID: ${requestId}）` : "";
                const result: { friendlyMessage: string; innerCode?: string } = {
                    friendlyMessage:
                        "检测到输入图片可能包含真人或隐私敏感信息，Seedance 已拒绝生成，请更换为不含真人的素材后重试。" +
                        suffix,
                };
                if (innerCode) {
                    result.innerCode = innerCode;
                }
                return result;
            }

            // 其他错误码，优先使用平台自带文案
            if (innerMsg) {
                const result: { friendlyMessage: string; innerCode?: string } = {
                    friendlyMessage: innerMsg,
                };
                if (innerCode) {
                    result.innerCode = innerCode;
                }
                return result;
            }

            const result: { friendlyMessage: string; innerCode?: string } = {
                friendlyMessage: rawMessage,
            };
            if (innerCode) {
                result.innerCode = innerCode;
            }
            return result;
        } catch {
            // 不是 JSON，就直接返回原始 message
            return { friendlyMessage: rawMessage };
        }
    }

    /**
     * 从任务查询响应中提取更完整的失败原因，优先读取结构化错误对象。
     * 典型场景：fail_reason 只有 "task failed"，而 inner.error 里才有具体 code/message。
     */
    private extractTaskError(top: any, inner: any, outer: any): string | null {
        const normalizeText = (v: unknown): string | null => {
            if (typeof v !== "string") return null;
            const t = v.trim();
            return t ? t : null;
        };
        const extractErrorText = (obj: any): string | null => {
            if (!obj) return null;
            const code = normalizeText(obj?.code);
            const message = normalizeText(obj?.message ?? obj?.msg ?? obj?.error_description);
            if (code && message) return `${code}: ${message}`;
            return message || code || null;
        };
        const genericFailTexts = new Set(["task failed", "failed", "fail", "error"]);

        // 1) 优先结构化错误（通常在 inner.error 或 top.error）
        const structuredError =
            extractErrorText(inner?.error) ||
            extractErrorText(top?.error) ||
            extractErrorText(outer?.error);
        if (structuredError) return structuredError;

        // 2) 再回退到常见文本字段
        const fallbackCandidates: Array<string | null> = [
            normalizeText(inner?.message),
            normalizeText(top?.message),
            normalizeText(outer?.message),
            normalizeText(inner?.fail_reason),
            normalizeText(top?.fail_reason),
        ];

        for (const item of fallbackCandidates) {
            if (!item) continue;
            if (!genericFailTexts.has(item.toLowerCase())) return item;
        }

        // 3) 最后才接受泛化文案
        return fallbackCandidates.find((item) => Boolean(item)) || null;
    }

    /**
     * 创建 Seedance 视频生成任务
     */
    async createVideoTask(input: {
        prompt: string;
        ratio?: string;
        duration?: number;
        resolution?: string;
        generateAudio?: boolean;
        enableWebSearch?: boolean;
    }): Promise<SeedanceCreateVideoResult> {
        const url = `${getBaseUrl()}/v1/video/generations`;

        const payload: SeedanceCreateVideoPayload = {
            model: this.getDefaultModel(),
            content: [
                {
                    type: "text",
                    text: input.prompt,
                },
            ],
            generate_audio: input.generateAudio ?? true,
            ratio: (input.ratio || this.getDefaultRatio()) as any,
            duration: input.duration ?? this.getDefaultDuration(),
            resolution: input.resolution || this.getDefaultResolution(),
            watermark: false,
        };

        if (input.enableWebSearch) {
            payload.tools = [{ type: "web_search" }];
        }

        try {
            const res = await axiosClient.post(url, payload, {
                headers: this.getHeaders(),
                timeout: 60000,
            });
            const data = res.data;
            return {
                id: data?.id || data?.task_id,
                task_id: data?.task_id || data?.id,
                status: data?.status ?? "",
                progress: typeof data?.progress === "number" ? data.progress : undefined,
                created_at: typeof data?.created_at === "number" ? data.created_at : undefined,
            };
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data;
                const parsed = this.parseSeedanceError(data);
                console.error("[SeedanceVideoAdapter] 创建视频任务失败", {
                    status,
                    data,
                });

                const err: any = new Error(parsed.friendlyMessage || error.message);
                if (typeof status === "number") {
                    err.status = status;
                }
                if (parsed.innerCode) {
                    err.code = parsed.innerCode;
                }
                err.raw = data;
                throw err;
            }
            throw error;
        }
    }

    /**
     * 高级模式：支持图生首帧 / 首尾帧 / 多参考图等，
     * 由调用方通过 action + 各类 URL 控制。
     */
    async createAdvancedVideoTask(input: SeedanceAdvancedInput): Promise<SeedanceCreateVideoResult> {
        const url = `${getBaseUrl()}/v1/video/generations`;

        // 根据 action 粗略估算参考资源数量，用于构造带别名说明的 prompt
        let imageCount = 0;
        let videoCount = 0;
        let audioCount = 0;

        if (input.action === "image_first_frame") {
            if (input.firstImageUrl) imageCount = 1;
        } else if (input.action === "image_first_last") {
            if (input.firstImageUrl) imageCount += 1;
            if (input.lastImageUrl) imageCount += 1;
        } else if (input.action === "multi_modal") {
            imageCount = Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls.length : 0;
            videoCount = Array.isArray(input.referenceVideoUrls) ? input.referenceVideoUrls.length : 0;
            audioCount = Array.isArray(input.referenceAudioUrls) ? input.referenceAudioUrls.length : 0;
        }

        const promptWithAliases = this.buildPromptWithMediaAliases(
            input.prompt,
            imageCount,
            videoCount,
            audioCount
        );

        const payload: SeedanceCreateVideoPayload = {
            model: this.getDefaultModel(),
            content: [
                {
                    type: "text",
                    text: promptWithAliases,
                },
            ],
            generate_audio: input.generateAudio ?? true,
            ratio: (input.ratio || this.getDefaultRatio()) as any,
            duration: input.duration ?? this.getDefaultDuration(),
            resolution: input.resolution || this.getDefaultResolution(),
            watermark: false,
        };

        // 根据 action 组装多模态内容
        const modalContents: SeedanceCreateVideoPayload["content"] = [];
        if (input.action === "image_first_frame") {
            if (input.firstImageUrl) {
                modalContents.push({
                    type: "image_url",
                    image_url: { url: input.firstImageUrl },
                    role: "first_frame",
                });
            }
        } else if (input.action === "image_first_last") {
            if (input.firstImageUrl) {
                modalContents.push({
                    type: "image_url",
                    image_url: { url: input.firstImageUrl },
                    role: "first_frame",
                });
            }
            if (input.lastImageUrl) {
                modalContents.push({
                    type: "image_url",
                    image_url: { url: input.lastImageUrl },
                    role: "last_frame",
                });
            }
        } else if (input.action === "multi_modal") {
            // 多模态总参考资源（图片+视频+音频）最多 9 个
            let totalRefs = 0;

            if (input.referenceImageUrls && input.referenceImageUrls.length > 0 && totalRefs < 9) {
                for (const url of input.referenceImageUrls) {
                    if (!url) continue;
                    if (totalRefs >= 9) break;
                    modalContents.push({
                        type: "image_url",
                        image_url: { url },
                        role: "reference_image",
                    });
                    totalRefs += 1;
                }
            }

            if (input.referenceVideoUrls && input.referenceVideoUrls.length > 0 && totalRefs < 9) {
                for (const url of input.referenceVideoUrls) {
                    if (!url) continue;
                    if (totalRefs >= 9) break;
                    modalContents.push({
                        type: "video_url",
                        video_url: { url },
                        role: "reference_video",
                    } as any);
                    totalRefs += 1;
                }
            }

            if (input.referenceAudioUrls && input.referenceAudioUrls.length > 0 && totalRefs < 9) {
                for (const url of input.referenceAudioUrls) {
                    if (!url) continue;
                    if (totalRefs >= 9) break;
                    modalContents.push({
                        type: "audio_url",
                        audio_url: { url },
                        role: "reference_audio",
                    } as any);
                    totalRefs += 1;
                }
            }
        }

        if (modalContents.length > 0) {
            payload.content.push(...modalContents as any);
        }

        if (input.enableWebSearch) {
            payload.tools = [{ type: "web_search" }];
        }

        try {
            const res = await axiosClient.post(url, payload, {
                headers: this.getHeaders(),
                timeout: 60000,
            });
            const data = res.data;
            return {
                id: data?.id || data?.task_id,
                task_id: data?.task_id || data?.id,
                status: data?.status ?? "",
                progress: typeof data?.progress === "number" ? data.progress : undefined,
                created_at: typeof data?.created_at === "number" ? data.created_at : undefined,
            };
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data;
                const parsed = this.parseSeedanceError(data);
                console.error("[SeedanceVideoAdapter] 创建高级视频任务失败", {
                    status,
                    data,
                });

                const err: any = new Error(parsed.friendlyMessage || error.message);
                if (typeof status === "number") {
                    err.status = status;
                }
                if (parsed.innerCode) {
                    err.code = parsed.innerCode;
                }
                err.raw = data;
                throw err;
            }
            throw error;
        }
    }

    /**
     * 查询 Seedance 视频生成任务状态
     */
    async getVideoTask(taskId: string): Promise<SeedanceGetVideoResult> {
        const url = `${getBaseUrl()}/v1/video/generations/${encodeURIComponent(taskId)}`;
        try {
            const res = await axiosClient.get(url, {
                headers: this.getHeaders(),
                timeout: 600000,
            });

            // Seedance 当前返回结构可能有多种包装形式，例如：
            // 1) { code, message, data: { ...真正的任务数据... } }
            // 2) { datas: { code, message, data: { ...真正的任务数据... } } }
            // 3) 直接返回任务数据 { status, content, ... }
            const outer = res.data ?? {};

            // 统一抽取「任务顶层数据」(含 task_id / status / fail_reason / progress / data)
            const top: any =
                (outer as any)?.data ??
                (outer as any)?.result ??
                (outer as any)?.datas?.data ??
                outer;

            // 进一步抽取真正的结果数据（通常位于 top.data）
            const inner: any = (top as any)?.data ?? top;

            // 状态解析：优先使用 inner.status，其次 top.status
            const rawStatus =
                inner?.status ||
                top?.status ||
                (top as any)?.task_status ||
                (top as any)?.taskStatus ||
                (top as any)?.state ||
                (top as any)?.action_status ||
                (outer as any)?.datas?.code ||
                outer?.status ||
                (outer as any)?.code;

            let statusStr = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
            // Seedance 会返回 IN_PROGRESS 这类状态，统一映射为 running
            if (statusStr === "in_progress" || statusStr === "in progress") {
                statusStr = "running";
            }

            let status: SeedanceTaskStatus = "unknown";
            if (["queued"].includes(statusStr)) status = "queued";
            else if (["running", "processing"].includes(statusStr)) status = "running";
            else if (["success", "succeeded"].includes(statusStr)) status = "succeeded";
            else if (["fail", "failed", "error"].includes(statusStr)) status = "failed";
            else if (["cancel", "canceled", "cancelled"].includes(statusStr)) status = "canceled";

            // 真实视频 URL 可能位于：
            // - inner.content.video_url
            // - inner.content[0].video_url
            // - inner.result.content.video_url
            // - inner.result.content[0].video_url
            // - inner.video_url / inner.result.video_url
            // - inner.url（部分接口直接返回 url 字段）
            let rawContent: any =
                (inner as any)?.content ??
                (inner as any)?.result?.content ??
                (top as any)?.content ??
                null;

            let videoUrl: string | null = null;

            if (rawContent) {
                if (Array.isArray(rawContent)) {
                    for (const item of rawContent) {
                        if (item && typeof item === "object" && (item as any).video_url) {
                            videoUrl = (item as any).video_url;
                            break;
                        }
                    }
                } else if (typeof rawContent === "object") {
                    if ((rawContent as any).video_url) {
                        videoUrl = (rawContent as any).video_url;
                    }
                }
            }

            if (!videoUrl) {
                videoUrl =
                    (inner as any)?.video_url ||
                    (inner as any)?.result?.video_url ||
                    (inner as any)?.url ||
                    (top as any)?.video_url ||
                    (top as any)?.url ||
                    null;
            }

            // 某些成功场景下 Seedance 会把带签名的视频 URL 放在 fail_reason 字段
            const failReason: string | undefined = (top as any)?.fail_reason;
            // 实测：有时 status 仍为 running/processing，但 fail_reason 已经给出了可播放 URL。
            // 只要 fail_reason 看起来是一个 URL，就将其视为 videoUrl，并把状态视为 succeeded，避免前端误判为“生成中/报错”。
            if (!videoUrl && typeof failReason === "string" && /^https?:\/\//.test(failReason)) {
                videoUrl = failReason;
                if (status === "running" || status === "queued" || status === "unknown") {
                    status = "succeeded";
                }
            }

            const progress =
                (top as any)?.progress ??
                (top as any)?.task_progress ??
                (top as any)?.progress_rate ??
                (inner as any)?.progress ??
                null;

            const duration =
                typeof (inner as any)?.duration === "number"
                    ? (inner as any).duration
                    : typeof (top as any)?.duration === "number"
                    ? (top as any).duration
                    : null;

            const ratio =
                typeof (inner as any)?.ratio === "string"
                    ? (inner as any).ratio
                    : typeof (top as any)?.ratio === "string"
                    ? (top as any).ratio
                    : null;

            const resolution =
                typeof (inner as any)?.resolution === "string"
                    ? (inner as any).resolution
                    : typeof (top as any)?.resolution === "string"
                    ? (top as any).resolution
                    : null;

            // errorMessage：仅在非成功状态下记录，优先结构化错误（code/message）
            let errorMessage: string | null = null;
            if (status !== "succeeded") {
                errorMessage = this.extractTaskError(top, inner, outer);
            }

            // 若成功拿到视频 URL，则优先下载并转存到本地/COS，返回稳定的 /uploads 路径
            let finalVideoUrl: string | null = videoUrl;
            if (videoUrl && typeof videoUrl === "string" && /^https?:\/\//.test(videoUrl)) {
                try {
                    finalVideoUrl = await this.downloadAndSaveVideo(videoUrl);
                } catch (e) {
                    // 转存失败不影响主流程：仍返回上游 URL，前端至少可播放
                    console.warn("[SeedanceVideoAdapter] 下载/转存视频失败，将回退使用上游 URL", {
                        taskId,
                        message: (e as any)?.message || String(e),
                    });
                    finalVideoUrl = videoUrl;
                }
            }

            return {
                raw: res.data,
                status,
                progress,
                videoUrl: finalVideoUrl,
                duration,
                ratio,
                resolution,
                errorMessage,
            };
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data;
                const msg =
                    (data as any)?.message ||
                    (data as any)?.error ||
                    (typeof data === "string" ? data : "") ||
                    error.message;
                console.error("[SeedanceVideoAdapter] 查询任务失败", {
                    taskId,
                    status,
                    data,
                });
                const err = new Error(`查询 Seedance 视频任务失败 (${status ?? "未知状态"}): ${msg}`);
                // 让控制器能够根据上游 HTTP 状态码返回 4xx/5xx，而不是一律 500
                (err as any).status = typeof status === "number" ? status : undefined;
                throw err;
            }
            throw error;
        }
    }

    /**
     * 下载远程视频并保存到 /uploads 目录（或 COS），返回供前端访问的相对路径
     */
    async downloadAndSaveVideo(remoteUrl: string): Promise<string> {
        const fileName = `seedance_video_${uuidv4()}.mp4`;
        const res = await axiosClient.get(remoteUrl, {
            responseType: "arraybuffer",
            // Seedance 链接可能较慢，默认 30 分钟，允许通过环境变量覆盖
            timeout: Number(process.env.SEEDANCE_VIDEO_DOWNLOAD_TIMEOUT_MS || "1800000"),
        });
        const buffer = Buffer.from(res.data);

        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, "video/mp4");
            return `/uploads/${fileName}`;
        }
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }
}

