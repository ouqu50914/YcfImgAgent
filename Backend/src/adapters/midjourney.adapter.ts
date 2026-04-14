import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";
import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { isCosEnabled, upload as cosUpload, pathToKey } from "../services/cos.service";
import { detectImageFormat } from "../utils/image-format";
import { ProviderError } from "./provider-error";

const axiosClient = axios.create({ proxy: false });

const MJ_REQUEST_TIMEOUT_MS = Number(process.env.ACE_MJ_REQUEST_TIMEOUT_MS || String(10 * 60 * 1000));
const MJ_POLL_INTERVAL_MS = Number(process.env.ACE_MJ_POLL_INTERVAL_MS || "3000");
const MJ_MAX_WAIT_MS = Number(process.env.ACE_MJ_MAX_WAIT_MS || String(2 * 60 * 1000));
const ACE_RETURN_REMOTE_URL = process.env.ACE_RETURN_REMOTE_URL === "true";

type MidjourneyResponse = {
    success?: boolean;
    task_id?: string;
    image_url?: string;
    raw_image_url?: string;
    sub_image_urls?: string[];
    error?: { code?: string; message?: string } | string;
    message?: string;
};

export class MidjourneyAdapter implements AiProvider {
    private getBaseUrl(apiUrl?: string): string {
        const fromEnv = process.env.ACE_API_URL?.trim();
        if (fromEnv) return fromEnv.replace(/\/$/, "");
        const fromConfig = apiUrl?.trim();
        if (fromConfig && fromConfig.includes("acedata.cloud")) return fromConfig.replace(/\/$/, "");
        return "https://api.acedata.cloud";
    }

    private getApiKey(apiKey?: string): string {
        const key = process.env.ACE_API_KEY || apiKey;
        if (!key) {
            throw new ProviderError({
                code: "ACE_API_KEY_MISSING",
                status: 500,
                message: "ACE_API_KEY 未配置，无法调用 Midjourney。",
                provider: "ace",
                transient: false,
            });
        }
        return key;
    }

    private getHeaders(apiKey?: string): Record<string, string> {
        return {
            authorization: `Bearer ${this.getApiKey(apiKey)}`,
            accept: "application/json",
            "content-type": "application/json",
        };
    }

    private extractImageUrls(data: any): string[] {
        const urls: string[] = [];
        const push = (u: unknown) => {
            if (typeof u === "string" && u.trim()) urls.push(u.trim());
        };

        push(data?.image_url);
        push(data?.raw_image_url);
        if (Array.isArray(data?.sub_image_urls)) {
            for (const u of data.sub_image_urls) push(u);
        }

        const response = data?.response;
        push(response?.image_url);
        push(response?.raw_image_url);
        if (Array.isArray(response?.sub_image_urls)) {
            for (const u of response.sub_image_urls) push(u);
        }

        if (Array.isArray(data?.items)) {
            for (const item of data.items) {
                const r = item?.response || item;
                push(r?.image_url);
                push(r?.raw_image_url);
                if (Array.isArray(r?.sub_image_urls)) {
                    for (const u of r.sub_image_urls) push(u);
                }
            }
        }

        return Array.from(new Set(urls));
    }

    private normalizeErrorMessage(data: any, fallback: string): string {
        if (typeof data === "string" && data.trim()) return data;
        const msg =
            data?.error?.message ||
            data?.error?.code ||
            data?.message ||
            data?.code ||
            fallback;
        return typeof msg === "string" ? msg : fallback;
    }

    private extractTaskFailureMessage(data: any): string | null {
        const candidates: unknown[] = [
            data?.error,
            data?.message,
            data?.msg,
            data?.response?.error,
            data?.response?.message,
            data?.response?.msg,
        ];
        if (Array.isArray(data?.items)) {
            for (const item of data.items) {
                const r = item?.response || item;
                candidates.push(r?.error, r?.message, r?.msg, r?.data?.error, r?.data?.message, r?.data?.msg);
                candidates.push(r?.status, r?.task_status, r?.state);
            }
        }

        const toMessage = (v: unknown): string | null => {
            if (!v) return null;
            if (typeof v === "string" && v.trim()) return v.trim();
            if (typeof v === "object") {
                const m = this.normalizeErrorMessage(v, "");
                return m ? m.trim() : null;
            }
            return null;
        };

        // 1) 显式 success=false
        const explicitFail =
            data?.success === false ||
            data?.ok === false ||
            data?.response?.success === false ||
            data?.response?.ok === false;
        if (explicitFail) {
            for (const c of candidates) {
                const msg = toMessage(c);
                if (msg) return msg;
            }
            return "Midjourney 任务失败";
        }

        // 2) 状态字段含失败语义
        const statusValues: string[] = [];
        const pushStatus = (v: unknown) => {
            if (typeof v === "string" && v.trim()) statusValues.push(v.trim().toLowerCase());
        };
        pushStatus(data?.status);
        pushStatus(data?.task_status);
        pushStatus(data?.state);
        pushStatus(data?.response?.status);
        pushStatus(data?.response?.task_status);
        pushStatus(data?.response?.state);
        if (Array.isArray(data?.items)) {
            for (const item of data.items) {
                const r = item?.response || item;
                pushStatus(r?.status);
                pushStatus(r?.task_status);
                pushStatus(r?.state);
                pushStatus(r?.data?.status);
                pushStatus(r?.data?.task_status);
                pushStatus(r?.data?.state);
            }
        }
        const hasFailedStatus = statusValues.some((s) => s.includes("fail") || s.includes("error") || s.includes("cancel"));
        if (hasFailedStatus) {
            for (const c of candidates) {
                const msg = toMessage(c);
                if (msg) return msg;
            }
            return "Midjourney 任务失败";
        }

        return null;
    }

    private mapError(error: any, fallbackMessage: string): ProviderError {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const message = this.normalizeErrorMessage(data, error?.message || fallbackMessage);
        const transient = status === 429 || (typeof status === "number" && status >= 500);
        return new ProviderError({
            code: typeof status === "number" ? `ACE_MJ_${status}` : "ACE_MJ_REQUEST_FAILED",
            status: typeof status === "number" ? status : 502,
            message: `Midjourney 请求失败: ${message}`,
            provider: "ace",
            transient,
        });
    }

    private async submitImagine(
        body: Record<string, unknown>,
        apiKey: string,
        apiUrl: string
    ): Promise<{ imageUrls?: string[]; taskId?: string }> {
        const endpoint = `${this.getBaseUrl(apiUrl)}/midjourney/imagine`;
        try {
            const res = await axiosClient.post(endpoint, body, {
                headers: this.getHeaders(apiKey),
                timeout: MJ_REQUEST_TIMEOUT_MS,
            });
            const data = res.data as MidjourneyResponse;
            const imageUrls = this.extractImageUrls(data);
            if (imageUrls.length > 0) return { imageUrls };
            if (typeof data?.task_id === "string" && data.task_id.trim()) return { taskId: data.task_id.trim() };
            throw new ProviderError({
                code: "ACE_MJ_UNEXPECTED_RESPONSE",
                status: 502,
                message: "Midjourney 返回结构异常：缺少 image_url 与 task_id。",
                provider: "ace",
                transient: true,
            });
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const taskId = error.response?.data?.task_id;
                if (typeof taskId === "string" && taskId.trim()) {
                    return { taskId: taskId.trim() };
                }
                throw this.mapError(error, "Midjourney imagine 调用失败");
            }
            throw error;
        }
    }

    private async retrieveTask(taskId: string, apiKey: string, apiUrl: string): Promise<string[]> {
        const endpoint = `${this.getBaseUrl(apiUrl)}/midjourney/tasks`;
        const startedAt = Date.now();

        while (Date.now() - startedAt <= MJ_MAX_WAIT_MS) {
            try {
                const res = await axiosClient.post(
                    endpoint,
                    { id: taskId, action: "retrieve" },
                    {
                        headers: this.getHeaders(apiKey),
                        timeout: MJ_REQUEST_TIMEOUT_MS,
                    }
                );
                const data = res.data;
                const failedMessage = this.extractTaskFailureMessage(data);
                if (failedMessage) {
                    throw new ProviderError({
                        code: "ACE_MJ_TASK_FAILED",
                        status: 502,
                        message: `Midjourney 任务失败: ${failedMessage}`,
                        provider: "ace",
                        transient: false,
                    });
                }
                const imageUrls = this.extractImageUrls(data);
                if (imageUrls.length > 0) return imageUrls;
            } catch (error: any) {
                if (error instanceof ProviderError) throw error;
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    if (status === 429 || (typeof status === "number" && status >= 500)) {
                        await new Promise((resolve) => setTimeout(resolve, MJ_POLL_INTERVAL_MS));
                        continue;
                    }
                    throw this.mapError(error, "Midjourney tasks retrieve 调用失败");
                }
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, MJ_POLL_INTERVAL_MS));
        }

        throw new ProviderError({
            code: "ACE_MJ_TASK_TIMEOUT",
            status: 504,
            message: "Midjourney 任务超时，未在限定时间内获取到图片。",
            provider: "ace",
            transient: true,
        });
    }

    private async downloadAndSaveImage(remoteUrl: string): Promise<string> {
        const res = await axiosClient.get(remoteUrl, {
            responseType: "arraybuffer",
            timeout: MJ_REQUEST_TIMEOUT_MS,
        });
        const buffer = Buffer.from(res.data);
        const ct = (res.headers as any)?.["content-type"];
        const pathname = (() => {
            try {
                return new URL(remoteUrl).pathname;
            } catch {
                return undefined;
            }
        })();
        const detectParams: { firstBytes: Buffer; contentTypeHeader?: string; urlPathname?: string } = {
            firstBytes: buffer.subarray(0, 32),
        };
        if (typeof ct === "string" && ct.trim()) detectParams.contentTypeHeader = ct;
        if (typeof pathname === "string" && pathname) detectParams.urlPathname = pathname;
        const detected = detectImageFormat(detectParams);
        const fileName = `midjourney_${uuidv4()}${detected.ext}`;

        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, detected.mime);
            return `/uploads/${fileName}`;
        }

        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }

    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        const imageInputs = Array.isArray(params.imageUrls) && params.imageUrls.length > 0
            ? params.imageUrls.filter((u) => typeof u === "string" && !!u.trim())
            : params.imageUrl
                ? [params.imageUrl]
                : [];

        // Midjourney 参考图能力通过“在 prompt 前拼接 URL”触发。
        const promptPrefix = imageInputs.length > 0 ? `${imageInputs.join(" ")} ` : "";
        const body: Record<string, unknown> = {
            prompt: `${promptPrefix}${params.prompt || "A beautiful scene"}`.trim(),
            action: params.mjAction || "generate",
            mode: params.mode || "fast",
        };
        if (typeof params.timeout === "number" && Number.isFinite(params.timeout) && params.timeout > 0) {
            body.timeout = params.timeout;
        }
        if (typeof params.translation === "boolean") body.translation = params.translation;
        if (typeof params.splitImages === "boolean") body.split_images = params.splitImages;
        if (typeof params.imageId === "string" && params.imageId.trim()) body.image_id = params.imageId.trim();
        if (typeof params.callbackUrl === "string" && params.callbackUrl.trim()) body.callback_url = params.callbackUrl.trim();

        const submitResult = await this.submitImagine(body, apiKey, apiUrl);
        let urls = submitResult.imageUrls || [];
        if (urls.length === 0) {
            const taskId = submitResult.taskId || params.taskId;
            if (!taskId) {
                throw new ProviderError({
                    code: "ACE_MJ_TASK_ID_MISSING",
                    status: 502,
                    message: "Midjourney 返回无任务 ID，无法进入任务查询兜底。",
                    provider: "ace",
                    transient: true,
                });
            }
            urls = await this.retrieveTask(taskId, apiKey, apiUrl);
        }

        const images: string[] = [];
        for (const url of urls) {
            if (!url.startsWith("http") || ACE_RETURN_REMOTE_URL) {
                images.push(url);
            } else {
                try {
                    images.push(await this.downloadAndSaveImage(url));
                } catch (error: any) {
                    const status = error?.response?.status;
                    // Midjourney CDN 常被 Cloudflare challenge 拦截（403），此时保留远程 URL，避免整单失败。
                    if (status === 403) {
                        console.warn("[MidjourneyAdapter] 下载图片被上游拒绝，回退为远程 URL", {
                            status,
                            url,
                        });
                        images.push(url);
                        continue;
                    }
                    throw error;
                }
            }
        }

        return {
            original_id: submitResult.taskId || `midjourney_${Date.now()}`,
            images,
        };
    }
}

