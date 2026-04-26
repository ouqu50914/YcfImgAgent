import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";
import { detectImageFormat } from "../utils/image-format";
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from "../services/cos.service";
import { ProviderError } from "./provider-error";

const axiosClient = axios.create({ proxy: false });
const ACE_GPT_IMAGE2_DEFAULT_BASE_URL = "https://api.acedata.cloud/openai/images";
const ACE_GPT_IMAGE2_REQUEST_TIMEOUT_MS = Number(process.env.ACE_IMG2_REQUEST_TIMEOUT_MS || "600000");

export class AceGptImage2Adapter implements AiProvider {
    private clamp(n: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, n));
    }

    private roundTo16(n: number): number {
        return Math.max(16, Math.round(n / 16) * 16);
    }

    private ratioToNumber(ratioText?: string): number {
        if (!ratioText) return 1;
        const m = ratioText.match(/^(\d+):(\d+)$/);
        if (!m) return 1;
        const w = Number(m[1]);
        const h = Number(m[2]);
        if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return 1;
        return w / h;
    }

    private targetPixelsByQuality(raw?: string): number {
        // low / medium / high -> 1K / 2K / 4K
        if (raw === "high") return 4194304;
        if (raw === "low") return 1048576;
        return 3145728;
    }

    private deriveSizeFromAspectRatio(aspectRatio?: string, quality?: string): string {
        const targetPixels = this.targetPixelsByQuality(quality);
        const ratio = this.clamp(this.ratioToNumber(aspectRatio), 1 / 3, 3);
        let width = this.roundTo16(Math.sqrt(targetPixels * ratio));
        let height = this.roundTo16(width / ratio);

        width = this.clamp(width, 16, 3840);
        height = this.clamp(height, 16, 3840);

        const pixels = () => width * height;
        if (pixels() < 655360) {
            const scale = Math.sqrt(655360 / Math.max(1, pixels()));
            width = this.clamp(this.roundTo16(width * scale), 16, 3840);
            height = this.clamp(this.roundTo16(height * scale), 16, 3840);
        }
        if (pixels() > 8294400) {
            const scale = Math.sqrt(8294400 / Math.max(1, pixels()));
            width = this.clamp(this.roundTo16(width * scale), 16, 3840);
            height = this.clamp(this.roundTo16(height * scale), 16, 3840);
        }
        return `${width}x${height}`;
    }

    private validateAndNormalizeSize(size?: string, aspectRatio?: string, quality?: string): string {
        const raw = typeof size === "string" ? size.trim() : "";
        if (!raw) {
            const derived = this.deriveSizeFromAspectRatio(aspectRatio, quality);
            console.warn("[AceGptImage2Adapter] size 缺失，已由 aspectRatio+quality 自动换算", {
                aspect_ratio: aspectRatio || "1:1",
                quality: quality || "medium",
                size: derived,
            });
            return derived;
        }
        const m = raw.match(/^(\d+)x(\d+)$/);
        if (!m) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_SIZE",
                status: 400,
                message: "size 格式非法，必须为 {宽}x{高}，例如 1536x1024",
                provider: "ace",
                transient: false,
            });
        }
        const width = Number(m[1]);
        const height = Number(m[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_SIZE",
                status: 400,
                message: "size 宽高必须为正整数",
                provider: "ace",
                transient: false,
            });
        }
        if (width % 16 !== 0 || height % 16 !== 0) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_SIZE_MULTIPLE",
                status: 400,
                message: "size 宽高必须是 16 的倍数",
                provider: "ace",
                transient: false,
            });
        }
        if (width > 3840 || height > 3840) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_SIZE_MAX_EDGE",
                status: 400,
                message: "size 最大边不能超过 3840",
                provider: "ace",
                transient: false,
            });
        }
        const ratio = Math.max(width / height, height / width);
        if (ratio > 3) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_ASPECT_RATIO",
                status: 400,
                message: "size 宽高比不能超过 3:1",
                provider: "ace",
                transient: false,
            });
        }
        const pixels = width * height;
        if (pixels < 655360 || pixels > 8294400) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_INVALID_PIXELS",
                status: 400,
                message: "size 像素总数需在 655360 - 8294400 之间",
                provider: "ace",
                transient: false,
            });
        }
        return `${width}x${height}`;
    }

    private getBaseUrl(): string {
        const base = process.env.ACE_IMG2_BASE_URL || ACE_GPT_IMAGE2_DEFAULT_BASE_URL;
        return base.replace(/\/$/, "");
    }

    private getApiKey(apiKeyFromConfig?: string): string {
        const key = process.env.ACE_IMG2_API_KEY || apiKeyFromConfig;
        if (!key) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_API_KEY_MISSING",
                status: 500,
                message: "ACE_IMG2_API_KEY 未配置，无法调用 Ace GPT-Image-2。",
                provider: "ace",
                transient: false,
            });
        }
        return key;
    }

    private normalizeQuality(raw?: string): "low" | "medium" | "high" {
        if (raw === "low" || raw === "high") return raw;
        return "medium";
    }

    private normalizeOutputFormat(raw?: string): "png" | "webp" | "jpeg" {
        if (raw === "webp" || raw === "jpeg") return raw;
        return "png";
    }

    private normalizeModeration(raw?: string): "auto" | "low" {
        if (raw === "low") return "low";
        return "auto";
    }

    private async resolveImageForEdit(imageInput: string): Promise<string> {
        if (!imageInput) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_REFERENCE_IMAGE_INVALID",
                status: 422,
                message: "参考图片为空",
                provider: "ace",
                transient: false,
            });
        }

        if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            return imageInput;
        }

        const dataUrlMatch = imageInput.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch && dataUrlMatch[1] && dataUrlMatch[2]) {
            return imageInput;
        }

        const pathPart = imageInput;
        let buffer: Buffer | null = null;
        if (pathPart.startsWith("/uploads/") || pathPart.includes("/uploads/")) {
            const pathNorm = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
            buffer = await getFileContent(pathNorm);
        } else if (!imageInput.startsWith("http")) {
            const localPath = path.join(process.cwd(), imageInput.startsWith("/") ? imageInput.slice(1) : imageInput);
            if (fs.existsSync(localPath)) {
                buffer = await fs.promises.readFile(localPath);
            }
        }

        if (!buffer) {
            throw new ProviderError({
                code: "ACE_GPT_IMAGE2_REFERENCE_IMAGE_INVALID",
                status: 422,
                message: `无法读取参考图片: ${imageInput}`,
                provider: "ace",
                transient: false,
            });
        }
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        return `data:${detected.mime};base64,${buffer.toString("base64")}`;
    }

    private async resolveImagesForEdit(imageInputs: string[]): Promise<string[]> {
        const normalized = imageInputs
            .filter((x) => typeof x === "string" && x.trim().length > 0)
            .map((x) => x.trim());
        const resolved: string[] = [];
        for (const input of normalized) {
            resolved.push(await this.resolveImageForEdit(input));
        }
        return resolved;
    }

    private summarizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
        const imageValue = body.image;
        const summarized: Record<string, unknown> = { ...body };
        delete summarized.image;
        delete summarized.image_urls;
        const toMeta = (value: string) => ({
            prefix: value.slice(0, 48),
            length: value.length,
        });
        const imageMeta = (() => {
            if (typeof imageValue === "string") return [toMeta(imageValue)];
            if (Array.isArray(imageValue)) {
                return imageValue
                    .filter((x) => typeof x === "string")
                    .map((x) => toMeta(x as string));
            }
            return [];
        })();
        return {
            ...summarized,
            image_meta: imageMeta.length > 0 ? imageMeta : undefined,
            image_count: imageMeta.length > 0 ? imageMeta.length : undefined,
        };
    }

    private async saveImageBuffer(buffer: Buffer): Promise<string> {
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        const fileName = `ace_gptimg2_${uuidv4()}${detected.ext}`;
        const savedPath = `/uploads/${fileName}`;
        if (isCosEnabled()) {
            await cosUpload(pathToKey(savedPath), buffer, detected.mime);
            return savedPath;
        }
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return savedPath;
    }

    private async normalizeImagesFromUrls(urls: string[]): Promise<string[]> {
        const out: string[] = [];
        for (const url of urls) {
            if (!url) continue;
            try {
                const res = await axiosClient.get(url, {
                    responseType: "arraybuffer",
                    timeout: ACE_GPT_IMAGE2_REQUEST_TIMEOUT_MS,
                });
                const saved = await this.saveImageBuffer(Buffer.from(res.data));
                out.push(saved);
            } catch (error: any) {
                console.error("[AceGptImage2Adapter] download_image_failed", {
                    url,
                    message: error?.message,
                });
                throw new ProviderError({
                    code: "ACE_GPT_IMAGE2_IMAGE_DOWNLOAD_FAILED",
                    status: 502,
                    message: `下载 Ace 结果图片失败: ${error?.message || "未知错误"}`,
                    provider: "ace",
                    transient: true,
                });
            }
        }
        return out;
    }

    async generateImage(params: GenerateParams, apiKeyFromConfig: string, _apiUrl: string): Promise<AiResponse> {
        const key = this.getApiKey(apiKeyFromConfig);
        const baseUrl = this.getBaseUrl();
        const refs = (params.imageUrls && params.imageUrls.length > 0)
            ? params.imageUrls.filter((x) => typeof x === "string" && x.trim().length > 0)
            : (params.imageUrl ? [params.imageUrl] : []);
        const hasRefImage = refs.length > 0;
        const endpoint = `${baseUrl}/${hasRefImage ? "edits" : "generations"}`;
        const count = Math.max(1, Math.min(params.num_images || (params as any).numImages || 1, 4));
        const quality = this.normalizeQuality(params.quality);
        const size = this.validateAndNormalizeSize(params.size, params.aspectRatio, quality);
        const outputFormat = this.normalizeOutputFormat(params.outputFormat);
        const moderation = this.normalizeModeration(params.moderation);
        const outputCompression = Number.isFinite(params.outputCompression)
            ? Math.max(0, Math.min(100, Number(params.outputCompression)))
            : undefined;

        const body: Record<string, unknown> = {
            model: "gpt-image-2",
            prompt: params.prompt || "生成图片",
            size,
        };

        if (count > 1) body.n = count;
        if (params.quality) body.quality = quality;
        if (params.outputFormat) body.output_format = outputFormat;
        if (params.moderation) body.moderation = moderation;
        if ((outputFormat === "jpeg" || outputFormat === "webp") && outputCompression != null) {
            body.output_compression = outputCompression;
        }
        if (hasRefImage) {
            const resolvedImages = await this.resolveImagesForEdit(refs);
            if (resolvedImages.length === 1) {
                body.image = resolvedImages[0];
            } else if (resolvedImages.length > 1) {
                // 实验性：对接可能支持多图数组的 OpenAI 兼容实现
                body.image = resolvedImages;
                body.image_urls = resolvedImages;
            }
        }

        console.log("[AceGptImage2Adapter] request_summary", {
            endpoint,
            prompt_length: String(body.prompt || "").length,
            size,
            n: body.n || 1,
            reference_image_count: refs.length,
            image_attached: typeof body.image === "string",
        });

        try {
            const resData = (await axiosClient.post(endpoint, body, {
                timeout: ACE_GPT_IMAGE2_REQUEST_TIMEOUT_MS,
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
            })).data;
            const urls = (Array.isArray(resData?.data) ? resData.data : [])
                .map((it: any) => (typeof it?.url === "string" ? it.url : ""))
                .filter((url: string) => url.length > 0);
            if (!urls.length) {
                throw new ProviderError({
                    code: "ACE_GPT_IMAGE2_EMPTY_IMAGE",
                    status: 502,
                    message: "Ace GPT-Image-2 返回成功但未包含图片 URL",
                    provider: "ace",
                    transient: true,
                });
            }
            const images = await this.normalizeImagesFromUrls(urls);
            return {
                original_id: String(resData?.task_id || `ace_gptimg2_${Date.now()}`),
                images,
            };
        } catch (error: any) {
            if (error instanceof ProviderError) throw error;
            const status = error?.response?.status;
            const responseData = error?.response?.data;
            const msg =
                responseData?.error?.message ||
                responseData?.message ||
                error?.message ||
                "未知错误";
            console.error("[AceGptImage2Adapter] request_failed", {
                endpoint,
                status,
                message: msg,
                request: this.summarizeRequestBody(body),
                response_data: responseData,
            });
            throw new ProviderError({
                code: status === 401
                    ? "ACE_GPT_IMAGE2_UNAUTHORIZED"
                    : status === 429
                        ? "ACE_GPT_IMAGE2_RATE_LIMITED"
                        : "ACE_GPT_IMAGE2_REQUEST_FAILED",
                status: typeof status === "number" ? status : 502,
                message: `Ace GPT-Image-2 请求失败: ${msg}`,
                provider: "ace",
                transient: status === 429 || (typeof status === "number" && status >= 500),
            });
        }
    }
}
