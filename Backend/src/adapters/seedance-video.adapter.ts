import axios from "axios";

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
    resolution?: "480p" | "720p" | string;
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
                const msg =
                    (data as any)?.message ||
                    (data as any)?.error ||
                    (typeof data === "string" ? data : "") ||
                    error.message;
                console.error("[SeedanceVideoAdapter] 创建视频任务失败", {
                    status,
                    data,
                });
                throw new Error(`创建 Seedance 视频任务失败 (${status ?? "未知状态"}): ${msg}`);
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
                const msg =
                    (data as any)?.message ||
                    (data as any)?.error ||
                    (typeof data === "string" ? data : "") ||
                    error.message;
                console.error("[SeedanceVideoAdapter] 创建高级视频任务失败", {
                    status,
                    data,
                });
                throw new Error(`创建 Seedance 高级视频任务失败 (${status ?? "未知状态"}): ${msg}`);
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
            if (!videoUrl && status === "succeeded" && typeof failReason === "string" && /^https?:\/\//.test(failReason)) {
                videoUrl = failReason;
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

            // errorMessage：仅在非成功状态下优先使用 fail_reason，其次 error/message
            let errorMessage: string | null = null;
            if (status !== "succeeded") {
                errorMessage =
                    (top as any)?.fail_reason ||
                    (inner as any)?.fail_reason ||
                    (inner as any)?.error ||
                    (inner as any)?.message ||
                    (top as any)?.error ||
                    (top as any)?.message ||
                    outer?.message ||
                    null;
            }

            return {
                raw: res.data,
                status,
                progress,
                videoUrl,
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
                throw new Error(`查询 Seedance 视频任务失败 (${status ?? "未知状态"}): ${msg}`);
            }
            throw error;
        }
    }
}

