import fs from "fs";
import path from "path";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import { isCosEnabled, upload as cosUpload, pathToKey } from "../services/cos.service";

const axiosClient = axios.create({ proxy: false });

export type KlingVideoMode = "text_to_video" | "image_to_video" | "omni";

export interface KlingTextToVideoParams {
    prompt: string;
    duration?: number; // 秒
    resolution?: "720p" | "1080p" | "4k";
    aspectRatio?: "16:9" | "9:16" | "1:1" | string;
    style?: string;
    fps?: number;
    seed?: number;
}

export interface KlingImageToVideoParams extends KlingTextToVideoParams {
    imageUrl: string;
}

export type KlingCreateTaskParams =
    | ({ mode: "text_to_video" } & KlingTextToVideoParams)
    | ({ mode: "image_to_video" } & KlingImageToVideoParams)
    | ({ mode: "omni" } & KlingTextToVideoParams & { imageUrl?: string; videoUrl?: string });

export interface KlingCreateTaskResult {
    taskId: string;
}

export interface KlingTaskStatus {
    rawStatus: any;
    status: "pending" | "running" | "succeeded" | "failed" | "canceled";
    progress?: number | null;
    errorMessage?: string | null;
    remoteVideoUrls?: string[];
}

export class KlingVideoAdapter {
    private cachedToken: { value: string; expiresAt: number } | null = null;

    private getBaseUrl(): string {
        const env = process.env.KLING_API_BASE_URL;
        if (env && env.trim().length > 0) {
            return env.replace(/\/$/, "");
        }
        // 默认使用文档推荐的北京区域域名
        return "https://api-beijing.klingai.com";
    }

    /**
     * 从环境变量中获取 AccessKey / SecretKey
     */
    private getAccessKey(): string {
        const ak = process.env.KLING_ACCESS_KEY_ID;
        if (!ak) {
            throw new Error("KLING_ACCESS_KEY_ID 环境变量未配置，请在 .env 中配置可灵 AccessKey");
        }
        return ak;
    }

    private getSecretKey(): string {
        const sk = process.env.KLING_ACCESS_KEY_SECRET;
        if (!sk) {
            throw new Error("KLING_ACCESS_KEY_SECRET 环境变量未配置，请在 .env 中配置可灵 SecretKey");
        }
        return sk;
    }

    /**
     * 按官方文档使用 AK/SK 生成 JWT 形式的 API Token，并做简单缓存
     */
    private async getApiToken(): Promise<string> {
        const now = Math.floor(Date.now() / 1000);

        // 若缓存的 token 仍在有效期内（预留 30 秒安全缓冲），直接复用
        if (this.cachedToken && this.cachedToken.expiresAt - 30 > now) {
            return this.cachedToken.value;
        }

        const ak = this.getAccessKey();
        const sk = this.getSecretKey();

        const ttlSeconds = Number(process.env.KLING_TOKEN_EXPIRE_SECONDS || "1800"); // 默认 30 分钟

        const payload = {
            iss: ak,
            exp: now + ttlSeconds,
            nbf: now - 5, // 文档：当前时间 - 5 秒，使 token 立即生效
        };

        const token = jwt.sign(payload, sk, {
            algorithm: "HS256",
            header: {
                alg: "HS256",
                typ: "JWT",
            },
        });

        this.cachedToken = {
            value: token,
            expiresAt: payload.exp,
        };

        return token;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        const token = await this.getApiToken();
        return {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
        };
    }

    /**
     * 创建视频任务（文生视频 / 图生视频 / OmniVideo）
     * 注意：具体的 URL 与字段名需要参考可灵官方文档后再调整。
     */
    async createTask(params: KlingCreateTaskParams): Promise<KlingCreateTaskResult> {
        const mode = params.mode;

        // 可灵官方路径（文档：textToVideo / imageToVideo / multiImageToVideo / OmniVideo）
        // 首尾帧（一镜到底）用 image2video + image_tail，与多图 multi-image2video 分开
        let endpoint = "";
        if (mode === "text_to_video") {
            endpoint = `${this.getBaseUrl()}/v1/videos/text2video`;
        } else if (mode === "image_to_video") {
            const imageSubType = (params as any).imageSubType as string | undefined;
            const endImageUrl = (params as any).endImageUrl as string | undefined;
            const imageList = (params as any).imageUrls as string[] | undefined;
            const hasFirstLast = imageSubType === "first_last" || (endImageUrl && String(endImageUrl).trim() !== "");
            const hasMulti = imageList && Array.isArray(imageList) && imageList.length > 1 && imageSubType !== "first_last";
            endpoint = hasMulti
                ? `${this.getBaseUrl()}/v1/videos/multi-image2video`
                : `${this.getBaseUrl()}/v1/videos/image2video`;
        } else {
            endpoint = `${this.getBaseUrl()}/v1/videos/omni-video`;
        }

        // 按可灵文档组装请求体：model、prompt 必填；duration 仅支持 5/10 秒；mode 为 std/pro
        const model = process.env.KLING_VIDEO_MODEL || "kling/kling-v1-6";
        const durationRaw = (params as any).duration;
        const duration =
            durationRaw === 10 || durationRaw === "10" ? "10" : "5";

        const body: Record<string, any> = {
            model,
            prompt: (params as any).prompt,
            mode: (params as any).klingMode === "pro" ? "pro" : "std",
            aspect_ratio: (params as any).aspectRatio || "16:9",
            duration,
        };

        if (mode === "image_to_video") {
            const imageSubType = (params as any).imageSubType as string | undefined;
            const endImageUrl = (params as any).endImageUrl as string | undefined;
            const imageList = (params as any).imageUrls as string[] | undefined;
            const hasFirstLast = imageSubType === "first_last" || (endImageUrl && String(endImageUrl).trim() !== "");

            if (hasFirstLast && (params as any).imageUrl) {
                // 首尾帧（一镜到底）：可灵文档 image + image_tail
                body.image = (params as any).imageUrl;
                if (endImageUrl) body.image_tail = endImageUrl;
            } else if (imageList && Array.isArray(imageList) && imageList.length > 0 && imageSubType !== "first_last") {
                if (imageList.length > 1) {
                    body.image_list = imageList.slice(0, 4).map((img) => ({ image: img }));
                } else {
                    body.image = imageList[0];
                }
            } else if ((params as any).imageUrl) {
                body.image = (params as any).imageUrl;
            }
        }
        if (mode === "omni") {
            if ((params as any).imageUrl) body.image = (params as any).imageUrl;
            if ((params as any).videoUrl) body.video_url = (params as any).videoUrl;
        }

        // 可选：负向提示词
        if ((params as any).negative_prompt) {
            body.negative_prompt = (params as any).negative_prompt;
        }

        // 清理 undefined 字段
        Object.keys(body).forEach((k) => {
            if (body[k] === undefined || body[k] === null) delete body[k];
        });

        try {
            const headers = await this.getHeaders();
            const res = await axiosClient.post(endpoint, body, {
            headers,
            timeout: Number(process.env.KLING_VIDEO_CREATE_TIMEOUT_MS || "1800000"),
            });

            const data = res.data;
            const taskId: string | undefined =
                data?.task_id ||
                data?.taskId ||
                data?.id ||
                (Array.isArray(data?.data) ? undefined : data?.data?.task_id);

            if (!taskId) {
                throw new Error("可灵创建任务成功但未返回 task_id，请检查 API 返回结构");
            }

            return { taskId };
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data;
                const code = (data as any)?.code;
                let msg =
                    (data as any)?.message ||
                    (data as any)?.error ||
                    (typeof data === "string" ? data : "") ||
                    error.message;
                if (status === 429 && (code === 1102 || String(msg).toLowerCase().includes("balance not enough"))) {
                    msg = "可灵账户余额不足，请前往可灵开放平台充值或购买视频资源包";
                }
                console.error("[KlingVideoAdapter] 创建任务失败", {
                    status,
                    data,
                });
                throw new Error(`创建可灵视频任务失败 (${status ?? "未知状态"}): ${msg}`);
            }
            throw error;
        }
    }

    /**
     * 查询任务状态，统一映射为内部状态枚举
     */
    async getTaskStatus(taskId: string): Promise<KlingTaskStatus> {
        const endpoint = `${this.getBaseUrl()}/v1/videos/tasks/${encodeURIComponent(taskId)}`;
        try {
            const headers = await this.getHeaders();
            const res = await axiosClient.get(endpoint, {
            headers,
            timeout: Number(process.env.KLING_VIDEO_STATUS_TIMEOUT_MS || "1800000"),
            });
            const data = res.data;

            // 根据文档可能存在的字段名做兼容
            const rawStatus: unknown =
                data?.status ||
                data?.task_status ||
                data?.state ||
                data?.data?.status;

            const statusStr = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";

            let mapped: KlingTaskStatus["status"] = "pending";
            if (["success", "succeeded", "finished", "done", "completed"].some((s) => statusStr.includes(s))) {
                mapped = "succeeded";
            } else if (["fail", "failed", "error"].some((s) => statusStr.includes(s))) {
                mapped = "failed";
            } else if (["cancel", "canceled", "cancelled"].some((s) => statusStr.includes(s))) {
                mapped = "canceled";
            } else if (["running", "processing", "queued"].some((s) => statusStr.includes(s))) {
                mapped = "running";
            } else {
                mapped = "pending";
            }

            // 解析进度（如果有）
            let progress: number | null = null;
            const p: unknown =
                data?.progress ||
                data?.percent ||
                data?.data?.progress ||
                data?.data?.percent;
            if (typeof p === "number") {
                progress = Math.max(0, Math.min(100, Math.round(p)));
            }

            // 解析错误信息
            const errorMessage: string | null =
                (data?.error as any) ||
                (data?.message as any) ||
                (data?.data?.error as any) ||
                (data?.data?.message as any) ||
                null;

            // 解析视频 URL 列表（成功时）
            const remoteVideoUrls = this.extractVideoUrls(data);

            return {
                rawStatus: data,
                status: mapped,
                progress,
                errorMessage,
                remoteVideoUrls,
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
                console.error("[KlingVideoAdapter] 查询任务失败", {
                    taskId,
                    status,
                    data,
                });
                throw new Error(`查询可灵视频任务失败 (${status ?? "未知状态"}): ${msg}`);
            }
            throw error;
        }
    }

    /**
     * 下载远程视频并保存到 /uploads 目录，返回供前端访问的相对路径
     */
    async downloadAndSaveVideo(remoteUrl: string): Promise<string> {
        const fileName = `kling_video_${uuidv4()}.mp4`;
        const res = await axiosClient.get(remoteUrl, {
            responseType: "arraybuffer",
            timeout: Number(process.env.KLING_VIDEO_DOWNLOAD_TIMEOUT_MS || "1800000"),
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

    /**
     * 从任务结果中提取视频 URL 列表，兼容多种返回结构
     */
    private extractVideoUrls(resData: any): string[] {
        const urls: string[] = [];

        if (!resData) return urls;

        // 常见结构：data.url / data.urls[]
        if (resData?.data?.url) urls.push(resData.data.url);
        if (Array.isArray(resData?.data?.urls)) {
            urls.push(...resData.data.urls);
        }

        // 顶层字段
        if (typeof resData.url === "string") urls.push(resData.url);
        if (Array.isArray(resData.urls)) urls.push(...resData.urls);

        // 结果数组
        if (Array.isArray(resData.data)) {
            for (const item of resData.data) {
                if (!item) continue;
                if (typeof item.url === "string") urls.push(item.url);
                if (typeof item.video_url === "string") urls.push(item.video_url);
            }
        }

        // 结果对象中的 result 字段
        if (Array.isArray(resData.result?.videos)) {
            urls.push(...resData.result.videos);
        }

        // 去重 & 非空
        return Array.from(
            new Set(
                urls.filter((u) => typeof u === "string" && u.length > 0)
            )
        );
    }
}

