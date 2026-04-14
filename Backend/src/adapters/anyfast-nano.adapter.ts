import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";
import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from "../services/cos.service";
import { detectImageFormat } from "../utils/image-format";
import { ProviderError } from "./provider-error";

const axiosClient = axios.create({ proxy: false });
const ANYFAST_REQUEST_TIMEOUT_MS = Number(process.env.ANYFAST_REQUEST_TIMEOUT_MS || String(10 * 60 * 1000));
const ANYFAST_BASE_URL = (process.env.ANYFAST_BASE_URL || "https://www.anyfast.ai").replace(/\/$/, "");
const ANYFAST_DEFAULT_MODEL = process.env.ANYFAST_NANO_DEFAULT_MODEL || "gemini-2.5-flash-image";
const ANYFAST_MAX_RETRIES = Math.max(0, Number(process.env.ANYFAST_MAX_RETRIES || "2"));
const ANYFAST_RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.ANYFAST_RETRY_BASE_DELAY_MS || "600"));

export class AnyfastNanoAdapter implements AiProvider {
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private isRetryableTransportError(error: any): boolean {
        const status = error?.response?.status;
        if (status === 429 || (typeof status === "number" && status >= 500)) return true;
        const msg = String(error?.message || "").toLowerCase();
        const code = String(error?.code || "").toLowerCase();
        if (msg.includes("stream has been aborted")) return true;
        if (msg.includes("aborted")) return true;
        if (msg.includes("socket hang up")) return true;
        if (msg.includes("econnreset")) return true;
        if (msg.includes("etimedout")) return true;
        if (msg.includes("network error")) return true;
        if (code === "econnreset" || code === "etimedout" || code === "ecconnaborted" || code === "eai_again") return true;
        return false;
    }

    private resolveModel(model?: string): string {
        if (model === "gemini-2.5-flash-image" || model === "gemini-3-pro-image-preview") {
            return model;
        }
        return ANYFAST_DEFAULT_MODEL;
    }

    private getApiKey(apiKeyFromConfig?: string): string {
        const key = process.env.ANYFAST_API_KEY || apiKeyFromConfig;
        if (!key) {
            throw new ProviderError({
                code: "ANYFAST_API_KEY_MISSING",
                status: 500,
                message: "ANYFAST_API_KEY 未配置，无法执行 AnyFast 兜底。",
                provider: "anyfast",
                transient: false,
            });
        }
        return key;
    }

    private async getImageBase64(imageInput: string): Promise<{ mimeType: string; data: string }> {
        if (imageInput.startsWith("data:")) {
            const m = imageInput.match(/^data:([^;]+);base64,(.+)$/);
            if (m && m[1] && m[2]) return { mimeType: m[1], data: m[2] };
        }

        const pathPart = imageInput.startsWith("http") && imageInput.includes("/uploads/")
            ? new URL(imageInput).pathname
            : imageInput;

        let buffer: Buffer | null = null;
        if (pathPart.startsWith("/uploads/") || pathPart.includes("/uploads/")) {
            const pathNorm = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
            buffer = await getFileContent(pathNorm);
        } else if (!imageInput.startsWith("http")) {
            const localPath = path.join(process.cwd(), imageInput.startsWith("/") ? imageInput.slice(1) : imageInput);
            if (fs.existsSync(localPath)) {
                buffer = await fs.promises.readFile(localPath);
            }
        } else {
            const res = await axiosClient.get(imageInput, {
                responseType: "arraybuffer",
                timeout: ANYFAST_REQUEST_TIMEOUT_MS,
            });
            buffer = Buffer.from(res.data);
        }

        if (!buffer) {
            throw new ProviderError({
                code: "ANYFAST_REFERENCE_IMAGE_INVALID",
                status: 422,
                message: `无法读取参考图片: ${imageInput}`,
                provider: "anyfast",
                transient: false,
            });
        }

        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        return { mimeType: detected.mime, data: buffer.toString("base64") };
    }

    private mapQuality(quality?: string): "1K" | "2K" | "4K" {
        if (quality === "2K" || quality === "4K") return quality;
        return "1K";
    }

    private extractImagesFromResponse(data: any): Buffer[] {
        const out: Buffer[] = [];
        const pushBase64 = (value: unknown) => {
            if (typeof value !== "string" || !value.trim()) return;
            out.push(Buffer.from(value, "base64"));
        };

        // Gemini 风格：candidates[].content.parts[]
        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        for (const candidate of candidates) {
            const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
            for (const part of parts) {
                pushBase64(part?.inline_data?.data); // snake_case
                pushBase64(part?.inlineData?.data); // camelCase
                pushBase64(part?.data); // 某些代理会直接返回 data
            }
        }

        // 一些中转服务会在 data/images 中直接放 base64
        if (Array.isArray(data?.images)) {
            for (const img of data.images) {
                pushBase64(img?.inline_data?.data);
                pushBase64(img?.inlineData?.data);
                pushBase64(img?.data);
                if (typeof img === "string") pushBase64(img);
            }
        }
        if (Array.isArray(data?.data?.images)) {
            for (const img of data.data.images) {
                pushBase64(img?.inline_data?.data);
                pushBase64(img?.inlineData?.data);
                pushBase64(img?.data);
                if (typeof img === "string") pushBase64(img);
            }
        }

        return out;
    }

    private async saveImageBuffer(buffer: Buffer): Promise<string> {
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        const fileName = `anyfast_${uuidv4()}${detected.ext}`;
        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, detected.mime);
            return `/uploads/${fileName}`;
        }
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }

    async generateImage(params: GenerateParams, apiKey: string, _apiUrl: string): Promise<AiResponse> {
        const count = Math.max(1, Math.min(params.num_images || (params as any).numImages || 1, 4));
        const model = this.resolveModel(params.model);
        const key = this.getApiKey(apiKey);

        const requestOnce = async (): Promise<string> => {
            const parts: Array<Record<string, unknown>> = [{ text: params.prompt || "生成图片" }];
            const refs = params.imageUrls && params.imageUrls.length > 0
                ? params.imageUrls
                : params.imageUrl
                ? [params.imageUrl]
                : [];

            for (const img of refs) {
                const b64 = await this.getImageBase64(img);
                parts.push({
                    inline_data: {
                        mime_type: b64.mimeType,
                        data: b64.data,
                    },
                });
            }

            const body = {
                contents: [{ role: "user", parts }],
                generationConfig: {
                    responseModalities: ["IMAGE"],
                    imageConfig: {
                        aspectRatio: params.aspectRatio || "1:1",
                        imageSize: this.mapQuality(params.quality),
                    },
                },
            };

            const endpoint = `${ANYFAST_BASE_URL}/v1beta/models/${model}:generateContent`;
            try {
                console.log("[AnyfastNanoAdapter] 请求摘要", {
                    endpoint,
                    model,
                    prompt: params.prompt || "生成图片",
                    reference_image_count: refs.length,
                    quality: this.mapQuality(params.quality),
                    aspect_ratio: params.aspectRatio || "1:1",
                    max_retries: ANYFAST_MAX_RETRIES,
                });
                let res: any;
                let lastError: any;
                for (let attempt = 0; attempt <= ANYFAST_MAX_RETRIES; attempt++) {
                    try {
                        console.log("[AnyfastNanoAdapter] 请求开始", {
                            attempt: attempt + 1,
                            total_attempts: ANYFAST_MAX_RETRIES + 1,
                            endpoint,
                            model,
                        });
                        res = await axiosClient.post(endpoint, body, {
                            params: { key },
                            timeout: ANYFAST_REQUEST_TIMEOUT_MS,
                            headers: { "Content-Type": "application/json" },
                        });
                        console.log("[AnyfastNanoAdapter] 请求成功", {
                            attempt: attempt + 1,
                            total_attempts: ANYFAST_MAX_RETRIES + 1,
                            status: res?.status,
                            topLevelKeys: res?.data && typeof res.data === "object" ? Object.keys(res.data) : [],
                        });
                        lastError = undefined;
                        break;
                    } catch (error: any) {
                        lastError = error;
                        const canRetry = this.isRetryableTransportError(error) && attempt < ANYFAST_MAX_RETRIES;
                        if (!canRetry) break;
                        const delay = ANYFAST_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                        console.warn("[AnyfastNanoAdapter] 请求失败，准备重试", {
                            attempt: attempt + 1,
                            next_delay_ms: delay,
                            message: error?.message,
                            code: error?.code,
                            status: error?.response?.status,
                        });
                        await this.sleep(delay);
                    }
                }
                if (!res) throw lastError;
                const buffers = this.extractImagesFromResponse(res.data);
                const first = buffers[0];
                if (!first) {
                    console.warn("[AnyfastNanoAdapter] 未解析到图片内容", {
                        model,
                        topLevelKeys: res?.data && typeof res.data === "object" ? Object.keys(res.data) : [],
                    });
                    throw new ProviderError({
                        code: "ANYFAST_EMPTY_IMAGE",
                        status: 502,
                        message: "AnyFast 返回成功但未包含图片内容。",
                        provider: "anyfast",
                        transient: true,
                    });
                }
                const savedPath = await this.saveImageBuffer(first);
                console.log("[AnyfastNanoAdapter] 最终返回", {
                    image_count: 1,
                    first_image: savedPath,
                });
                return savedPath;
            } catch (error: any) {
                if (error instanceof ProviderError) throw error;
                const status = error?.response?.status;
                const msg = error?.response?.data?.error?.message || error?.message || "未知错误";
                const transient = this.isRetryableTransportError(error);
                throw new ProviderError({
                    code: status === 429 ? "ANYFAST_RATE_LIMITED" : "ANYFAST_REQUEST_FAILED",
                    status: typeof status === "number" ? status : 502,
                    message: `AnyFast 请求失败: ${msg}`,
                    provider: "anyfast",
                    transient,
                });
            }
        };

        const tasks = Array(count).fill(0).map(async () => requestOnce());
        const result = await Promise.all(tasks);
        return {
            original_id: `anyfast_${Date.now()}`,
            images: result,
        };
    }
}
