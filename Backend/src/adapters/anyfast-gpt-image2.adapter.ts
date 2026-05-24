import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";
import { detectImageFormat } from "../utils/image-format";
import { isCosEnabled, upload as cosUpload, pathToKey } from "../services/cos.service";
import { getFileContent } from "../services/cos.service";
import { ProviderError } from "./provider-error";

const axiosClient = axios.create({ proxy: false });
const GPT_IMAGE2_DEFAULT_BASE_URL = "https://www.anyfast.ai";
const GPT_IMAGE2_REQUEST_TIMEOUT_MS = Number(process.env.GPT_IMG2_REQUEST_TIMEOUT_MS || "600000");

export class AnyfastGptImage2Adapter implements AiProvider {
    private summarizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
        const imageValue = typeof body.image === "string" ? body.image : undefined;
        const summarized: Record<string, unknown> = { ...body };
        delete summarized.image;
        delete summarized.input_image;
        return {
            ...summarized,
            image_meta: imageValue
                ? {
                    data_url_prefix: imageValue.slice(0, 48),
                    data_url_length: imageValue.length,
                }
                : undefined,
        };
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

    private clamp(n: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, n));
    }

    private roundTo16(n: number): number {
        return Math.max(16, Math.round(n / 16) * 16);
    }

    private targetPixelsByQuality(raw?: string): number {
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

    private getBaseUrl(): string {
        const base = process.env.GPT_IMG2_BASE_URL || GPT_IMAGE2_DEFAULT_BASE_URL;
        return base.replace(/\/$/, "");
    }

    private resolveUpstreamModel(model?: GenerateParams["model"]): "gpt-image-2" | "gpt-image-2-c" {
        return model === "gpt-image-2-c" ? "gpt-image-2-c" : "gpt-image-2";
    }

    private getApiKey(apiKeyFromConfig?: string, model?: GenerateParams["model"]): string {
        const upstreamModel = this.resolveUpstreamModel(model);
        const key = upstreamModel === "gpt-image-2-c"
            ? (process.env.GPT_IMG2_API_KEY_C || apiKeyFromConfig)
            : (process.env.GPT_IMG2_API_KEY || process.env.ANYFAST_API_KEY || apiKeyFromConfig);
        if (!key) {
            throw new ProviderError({
                code: upstreamModel === "gpt-image-2-c" ? "GPT_IMAGE2_C_API_KEY_MISSING" : "GPT_IMAGE2_API_KEY_MISSING",
                status: 500,
                message: upstreamModel === "gpt-image-2-c"
                    ? "GPT_IMG2_API_KEY_C 未配置，无法调用 GPT Image 2-C。"
                    : "GPT_IMG2_API_KEY 未配置，无法调用 GPT Image 2。",
                provider: "anyfast",
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

    private async resolveImageBuffer(
        imageInput: string
    ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
        if (!imageInput) {
            throw new ProviderError({
                code: "GPT_IMAGE2_REFERENCE_IMAGE_INVALID",
                status: 422,
                message: "参考图片为空",
                provider: "anyfast",
                transient: false,
            });
        }

        const dataUrlMatch = imageInput.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch && dataUrlMatch[1] && dataUrlMatch[2]) {
            const mimeType = dataUrlMatch[1];
            const buffer = Buffer.from(dataUrlMatch[2], "base64");
            return {
                buffer,
                mimeType,
                fileName: `ref_${uuidv4()}.png`,
            };
        }

        if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            const res = await axiosClient.get(imageInput, {
                responseType: "arraybuffer",
                timeout: GPT_IMAGE2_REQUEST_TIMEOUT_MS,
            });
            const buffer = Buffer.from(res.data);
            const contentType = typeof res.headers?.["content-type"] === "string" ? res.headers["content-type"] : undefined;
            const detectArgs: { firstBytes: Buffer; contentTypeHeader?: string; urlPathname?: string } = {
                firstBytes: buffer.subarray(0, 32),
            };
            if (contentType) detectArgs.contentTypeHeader = contentType;
            const pathname = (() => {
                try {
                    return new URL(imageInput).pathname;
                } catch {
                    return undefined;
                }
            })();
            if (pathname) detectArgs.urlPathname = pathname;
            const detected = detectImageFormat(detectArgs);
            return {
                buffer,
                mimeType: detected.mime,
                fileName: `ref_${uuidv4()}${detected.ext}`,
            };
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
                code: "GPT_IMAGE2_REFERENCE_IMAGE_INVALID",
                status: 422,
                message: `无法读取参考图片: ${imageInput}`,
                provider: "anyfast",
                transient: false,
            });
        }
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        return {
            buffer,
            mimeType: detected.mime,
            fileName: `ref_${uuidv4()}${detected.ext}`,
        };
    }

    private validateAndNormalizeSize(size?: string, aspectRatio?: string, quality?: string): string {
        const raw = typeof size === "string" ? size.trim() : "";
        if (!raw) {
            const derived = this.deriveSizeFromAspectRatio(aspectRatio, quality);
            console.warn("[AnyfastGptImage2Adapter] size 缺失，已由 aspectRatio+quality 自动换算", {
                aspect_ratio: aspectRatio || "1:1",
                quality: quality || "medium",
                size: derived,
            });
            return derived;
        }
        const m = raw.match(/^(\d+)x(\d+)$/);
        if (!m) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_SIZE",
                status: 400,
                message: "size 格式非法，必须为 {宽}x{高}，例如 1536x1024",
                provider: "anyfast",
                transient: false,
            });
        }
        const width = Number(m[1]);
        const height = Number(m[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_SIZE",
                status: 400,
                message: "size 宽高必须为正整数",
                provider: "anyfast",
                transient: false,
            });
        }
        if (width % 16 !== 0 || height % 16 !== 0) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_SIZE_MULTIPLE",
                status: 400,
                message: "size 宽高必须是 16 的倍数",
                provider: "anyfast",
                transient: false,
            });
        }
        if (width > 3840 || height > 3840) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_SIZE_MAX_EDGE",
                status: 400,
                message: "size 最大边不能超过 3840",
                provider: "anyfast",
                transient: false,
            });
        }
        const ratio = Math.max(width / height, height / width);
        if (ratio > 3) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_ASPECT_RATIO",
                status: 400,
                message: "size 宽高比不能超过 3:1",
                provider: "anyfast",
                transient: false,
            });
        }
        const pixels = width * height;
        if (pixels < 655360 || pixels > 8294400) {
            throw new ProviderError({
                code: "GPT_IMAGE2_INVALID_PIXELS",
                status: 400,
                message: "size 像素总数需在 655360 - 8294400 之间",
                provider: "anyfast",
                transient: false,
            });
        }
        return `${width}x${height}`;
    }

    private enrichPromptWithComputedSize(prompt: string, size: string): string {
        if (prompt.includes(size)) return prompt;
        return `${prompt}。输出尺寸：${size}。`;
    }

    private async saveImageBuffer(buffer: Buffer): Promise<string> {
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        const fileName = `gptimg2_${uuidv4()}${detected.ext}`;
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

    /** 打印上游响应结构（不输出完整 base64） */
    private summarizeUpstreamResponse(data: unknown): Record<string, unknown> {
        if (data == null) return { value: data };
        if (typeof data !== "object") return { type: typeof data, value: data };

        const root = data as Record<string, unknown>;
        const summarizeItem = (it: unknown, idx: number) => {
            if (it == null || typeof it !== "object") return { idx, type: typeof it };
            const item = it as Record<string, unknown>;
            const summary: Record<string, unknown> = {
                idx,
                keys: Object.keys(item),
            };
            if (typeof item.url === "string") summary.url_prefix = item.url.slice(0, 120);
            if (typeof item.b64_json === "string") summary.b64_json_length = item.b64_json.length;
            if (typeof item.image_url === "string") summary.image_url_prefix = item.image_url.slice(0, 120);
            return summary;
        };

        const dataItems = Array.isArray(root.data) ? root.data : [];
        const output = root.output;
        const outputItems = output && typeof output === "object" && Array.isArray((output as { data?: unknown }).data)
            ? (output as { data: unknown[] }).data
            : [];

        return {
            top_level_keys: Object.keys(root),
            data_array_length: dataItems.length,
            data_items_preview: dataItems.slice(0, 4).map(summarizeItem),
            output_type: output == null ? undefined : typeof output,
            output_keys: output && typeof output === "object" ? Object.keys(output as object) : undefined,
            output_data_length: outputItems.length,
            output_data_preview: outputItems.slice(0, 4).map(summarizeItem),
            task_id: root.task_id,
            id: root.id,
            status: root.status,
            created: root.created,
            error: root.error,
            message: root.message,
        };
    }

    private collectResponseItems(resData: Record<string, unknown>): unknown[] {
        const items: unknown[] = [];
        if (Array.isArray(resData.data)) items.push(...resData.data);
        const output = resData.output;
        if (output && typeof output === "object" && Array.isArray((output as { data?: unknown }).data)) {
            items.push(...(output as { data: unknown[] }).data);
        }
        if (Array.isArray(resData.images)) items.push(...resData.images);
        return items;
    }

    private async normalizeImagesFromUrls(urls: string[]): Promise<string[]> {
        const out: string[] = [];
        for (const url of urls) {
            if (!url) continue;
            try {
                const res = await axiosClient.get(url, {
                    responseType: "arraybuffer",
                    timeout: GPT_IMAGE2_REQUEST_TIMEOUT_MS,
                });
                const saved = await this.saveImageBuffer(Buffer.from(res.data));
                out.push(saved);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error("[AnyfastGptImage2Adapter] download_image_failed", { url: url.slice(0, 120), message });
                throw new ProviderError({
                    code: "GPT_IMAGE2_IMAGE_DOWNLOAD_FAILED",
                    status: 502,
                    message: `下载 GPT Image 2 结果图片失败: ${message}`,
                    provider: "anyfast",
                    transient: true,
                });
            }
        }
        return out;
    }

    private async parseImagesFromResponse(resData: unknown): Promise<string[]> {
        if (!resData || typeof resData !== "object") return [];
        const root = resData as Record<string, unknown>;
        const items = this.collectResponseItems(root);

        const imagesB64 = items
            .map((it) => {
                if (!it || typeof it !== "object") return "";
                const row = it as Record<string, unknown>;
                return typeof row.b64_json === "string" ? row.b64_json : "";
            })
            .filter((s) => s.length > 0);
        if (imagesB64.length > 0) {
            return Promise.all(imagesB64.map((b64) => this.saveImageBuffer(Buffer.from(b64, "base64"))));
        }

        const urls = items
            .map((it) => {
                if (!it || typeof it !== "object") return "";
                const row = it as Record<string, unknown>;
                if (typeof row.url === "string") return row.url;
                if (typeof row.image_url === "string") return row.image_url;
                return "";
            })
            .filter((url) => url.length > 0);
        if (urls.length > 0) {
            return this.normalizeImagesFromUrls(urls);
        }

        return [];
    }

    async generateImage(params: GenerateParams, apiKeyFromConfig: string, _apiUrl: string): Promise<AiResponse> {
        const upstreamModel = this.resolveUpstreamModel(params.model);
        const key = this.getApiKey(apiKeyFromConfig, params.model);
        const baseUrl = this.getBaseUrl();
        const endpointGenerate = `${baseUrl}/v1/images/generations`;
        const count = Math.max(1, Math.min(params.num_images || (params as any).numImages || 1, 4));
        const quality = this.normalizeQuality(params.quality);
        const size = this.validateAndNormalizeSize(params.size, params.aspectRatio, quality);
        const outputFormat = this.normalizeOutputFormat(params.outputFormat);
        const moderation = this.normalizeModeration(params.moderation);
        const outputCompression = Number.isFinite(params.outputCompression)
            ? Math.max(0, Math.min(100, Number(params.outputCompression)))
            : undefined;

        const body: Record<string, unknown> = {
            model: upstreamModel,
            prompt: this.enrichPromptWithComputedSize(params.prompt || "生成图片", size),
            n: count,
            size,
            quality,
            output_format: outputFormat,
            moderation,
        };

        if ((outputFormat === "jpeg" || outputFormat === "webp") && outputCompression != null) {
            body.output_compression = outputCompression;
        }
        const refs = (params.imageUrls && params.imageUrls.length > 0)
            ? params.imageUrls.filter((x) => typeof x === "string" && x.trim().length > 0)
            : (params.imageUrl ? [params.imageUrl] : []);
        const firstRef = refs[0];
        if (firstRef) {
            const { buffer, mimeType } = await this.resolveImageBuffer(firstRef);
            body.image = `data:${mimeType};base64,${buffer.toString("base64")}`;
        }
        console.log("[AnyfastGptImage2Adapter] request_summary", {
            endpoint: endpointGenerate,
            model: body.model,
            prompt_length: String(body.prompt || "").length,
            n: count,
            size,
            quality,
            output_format: outputFormat,
            moderation,
            reference_image_count: refs.length,
            image_attached: typeof body.image === "string",
        });
        console.log("[AnyfastGptImage2Adapter] request_payload_before_send", {
            endpoint: endpointGenerate,
            timeout_ms: GPT_IMAGE2_REQUEST_TIMEOUT_MS,
            headers: {
                Authorization: "Bearer ****",
                "Content-Type": "application/json",
            },
            body: this.summarizeRequestBody(body),
        });

        try {
            const resData = (await axiosClient.post(endpointGenerate, body, {
                timeout: GPT_IMAGE2_REQUEST_TIMEOUT_MS,
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                },
            })).data;

            const responseSummary = this.summarizeUpstreamResponse(resData);
            console.log("[AnyfastGptImage2Adapter] response_summary", {
                endpoint: endpointGenerate,
                model: upstreamModel,
                ...responseSummary,
            });

            const images = await this.parseImagesFromResponse(resData);
            if (!images.length) {
                console.warn("[AnyfastGptImage2Adapter] empty_image_response", {
                    endpoint: endpointGenerate,
                    model: upstreamModel,
                    response_summary: responseSummary,
                });
                throw new ProviderError({
                    code: "GPT_IMAGE2_EMPTY_IMAGE",
                    status: 502,
                    message: "GPT Image 2 返回成功但未包含图片数据（详见服务端日志 response_summary）",
                    provider: "anyfast",
                    transient: true,
                });
            }

            const originalId =
                (resData && typeof resData === "object" && (resData as Record<string, unknown>).id != null)
                    ? String((resData as Record<string, unknown>).id)
                    : (resData && typeof resData === "object" && (resData as Record<string, unknown>).task_id != null)
                        ? String((resData as Record<string, unknown>).task_id)
                        : `gptimg2_${Date.now()}`;

            console.log("[AnyfastGptImage2Adapter] response_parsed", {
                endpoint: endpointGenerate,
                model: upstreamModel,
                image_count: images.length,
                original_id: originalId,
            });

            return {
                original_id: originalId,
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
            console.error("[AnyfastGptImage2Adapter] request_failed", {
                endpoint: endpointGenerate,
                status,
                message: msg,
                request: this.summarizeRequestBody(body),
                response_summary: this.summarizeUpstreamResponse(responseData),
            });
            throw new ProviderError({
                code: status === 429 ? "GPT_IMAGE2_RATE_LIMITED" : "GPT_IMAGE2_REQUEST_FAILED",
                status: typeof status === "number" ? status : 502,
                message: `GPT Image 2 请求失败: ${msg}`,
                provider: "anyfast",
                transient: status === 429 || (typeof status === "number" && status >= 500),
            });
        }
    }
}
