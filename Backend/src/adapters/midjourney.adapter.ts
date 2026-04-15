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
    private logMidjourneyRequest(stage: string, payload: Record<string, unknown>) {
        try {
            console.info(`[MidjourneyAdapter] ${stage}`, payload);
        } catch {
            // ignore logging serialization issues
        }
    }

    private resolvePromptAndReferences(
        prompt: string,
        imageInputs: string[],
        imageAliases?: number[]
    ): { prompt: string; imageUrls: string[]; aliasMapText: string } {
        const basePrompt = (prompt || "A beautiful scene").trim();
        if (imageInputs.length === 0) return { prompt: basePrompt, imageUrls: [], aliasMapText: "" };

        // 以 imageAliases 为优先映射；缺失时按顺序映射为 图1、图2...
        const aliasToUrl = new Map<number, string>();
        const aliasPairs: Array<{ alias: number; url: string }> = [];
        for (let i = 0; i < imageInputs.length; i++) {
            const alias = Array.isArray(imageAliases) && typeof imageAliases[i] === "number" && imageAliases[i]! > 0
                ? Number(imageAliases[i])
                : i + 1;
            const url = imageInputs[i]!;
            aliasToUrl.set(alias, url);
            // 同时注册顺序别名，避免前端未传 imageAliases 时 @图N 无法命中。
            aliasToUrl.set(i + 1, url);
            aliasPairs.push({ alias, url });
        }

        const aliasHits: string[] = [];
        // Midjourney 不识别 @图N 语法，这里替换成真实 URL，并记录命中的别名顺序。
        const promptResolved = basePrompt.replace(/@图(\d+)/g, (_m, n) => {
            const aliasNum = Number(n);
            const mapped = aliasToUrl.get(aliasNum) || (imageInputs.length === 1 ? imageInputs[0] : undefined);
            if (mapped) {
                aliasHits.push(mapped);
                return `${mapped} `;
            }
            return "";
        });
        const hasAliasInPrompt = /@图\d+/.test(basePrompt);
        const orderedImageUrls = hasAliasInPrompt
            ? Array.from(new Set([...aliasHits, ...imageInputs]))
            : Array.from(new Set(imageInputs));
        const cleanedPrompt = promptResolved.replace(/\s+/g, " ").trim();
        const aliasMapText = aliasPairs
            .map((pair) => `图${pair.alias}=${pair.url}`)
            .join(" ");
        // 参考图 URL 统一放在前面，后面追加别名映射，便于排查与复现。
        const finalPrompt = `${orderedImageUrls.join(" ")} ${cleanedPrompt || basePrompt} ${aliasMapText}`.trim();
        return { prompt: finalPrompt, imageUrls: orderedImageUrls, aliasMapText };
    }

    private resolveMidjourneyQuality(raw?: string): string | undefined {
        if (!raw || !raw.trim()) return undefined;
        const v = raw.trim().toUpperCase();
        if (v === "1K" || v === "1") return "1";
        if (v === "2K" || v === "2") return "2";
        if (v === "4K" || v === "4") return "4";
        if (/^(?:0?\.25|0?\.5|1|2|4)$/.test(raw.trim())) return raw.trim().replace(/^0\./, ".");
        return undefined;
    }

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
        const splitUrls: string[] = [];
        const normalUrls: string[] = [];
        const pushSplit = (u: unknown) => {
            if (typeof u === "string" && u.trim()) splitUrls.push(u.trim());
        };
        const pushNormal = (u: unknown) => {
            if (typeof u === "string" && u.trim()) normalUrls.push(u.trim());
        };

        if (Array.isArray(data?.sub_image_urls)) {
            for (const u of data.sub_image_urls) pushSplit(u);
        }
        const response = data?.response;
        if (Array.isArray(response?.sub_image_urls)) {
            for (const u of response.sub_image_urls) pushSplit(u);
        }
        if (Array.isArray(data?.items)) {
            for (const item of data.items) {
                const r = item?.response || item;
                if (Array.isArray(r?.sub_image_urls)) {
                    for (const u of r.sub_image_urls) pushSplit(u);
                }
            }
        }

        // 优先使用拆分子图，避免 image_url/raw_image_url 造成“同图重复”。
        const uniqueSplit = Array.from(new Set(splitUrls));
        if (uniqueSplit.length > 0) return uniqueSplit;

        pushNormal(data?.image_url);
        pushNormal(data?.raw_image_url);
        pushNormal(response?.image_url);
        pushNormal(response?.raw_image_url);
        if (Array.isArray(data?.items)) {
            for (const item of data.items) {
                const r = item?.response || item;
                // 每个对象最多取一个主图 URL，避免一张图被 image_url/raw_image_url 重复计入。
                const primary = (typeof r?.image_url === "string" && r.image_url.trim())
                    ? r.image_url.trim()
                    : (typeof r?.raw_image_url === "string" ? r.raw_image_url.trim() : "");
                if (primary) pushNormal(primary);
            }
        }

        return Array.from(new Set(normalUrls));
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
        this.logMidjourneyRequest("submitImagine.request", {
            endpoint,
            body,
        });
        try {
            const res = await axiosClient.post(endpoint, body, {
                headers: this.getHeaders(apiKey),
                timeout: MJ_REQUEST_TIMEOUT_MS,
            });
            const data = res.data as MidjourneyResponse;
            this.logMidjourneyRequest("submitImagine.response", {
                task_id: data?.task_id,
                success: data?.success,
                image_url: data?.image_url,
                raw_image_url: data?.raw_image_url,
                sub_image_count: Array.isArray(data?.sub_image_urls) ? data.sub_image_urls.length : 0,
                error: data?.error,
                message: data?.message,
            });
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
                this.logMidjourneyRequest("retrieveTask.response", {
                    task_id: taskId,
                    elapsed_ms: Date.now() - startedAt,
                    success: data?.success,
                    status: data?.status,
                    image_url: data?.image_url,
                    raw_image_url: data?.raw_image_url,
                    sub_image_count: Array.isArray(data?.sub_image_urls) ? data.sub_image_urls.length : 0,
                    items_count: Array.isArray(data?.items) ? data.items.length : 0,
                    message: data?.message,
                    error: data?.error,
                });
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
        const count = Math.max(1, Math.min(params.num_images || (params as any).numImages || 1, 4));
        const referenceResolved = this.resolvePromptAndReferences(
            params.prompt || "A beautiful scene",
            imageInputs,
            params.imageAliases
        );
        const qualityToken = this.resolveMidjourneyQuality(params.quality);
        const bodyBase: Record<string, unknown> = {
            prompt: referenceResolved.prompt,
            action: params.mjAction || "generate",
            mode: params.mode || "fast",
            version: "8",
        };
        if (typeof params.timeout === "number" && Number.isFinite(params.timeout) && params.timeout > 0) {
            bodyBase.timeout = params.timeout;
        }
        if (typeof params.translation === "boolean") bodyBase.translation = params.translation;
        const splitEnabled = typeof params.splitImages === "boolean" ? params.splitImages : true;
        // 兼容不同网关参数命名：split_images / split_image
        bodyBase.split_images = splitEnabled;
        bodyBase.split_image = splitEnabled;
        if (referenceResolved.imageUrls.length > 0) {
            // 兼容部分 Midjourney 网关：参考图走 image_urls 字段。
            bodyBase.image_urls = referenceResolved.imageUrls;
        }
        if (typeof params.aspectRatio === "string" && params.aspectRatio.trim()) {
            const ar = params.aspectRatio.trim();
            // 兼容网关字段 + Midjourney prompt 参数 --ar。
            bodyBase.aspect_ratio = ar;
            bodyBase.ar = ar;
            if (typeof bodyBase.prompt === "string" && !/\s--(?:ar|aspect)\s+\d+:\d+/i.test(bodyBase.prompt)) {
                bodyBase.prompt = `${bodyBase.prompt} --ar ${ar}`.trim();
            }
        }
        if (typeof bodyBase.prompt === "string" && !/\s--version\s+\S+/i.test(bodyBase.prompt)) {
            bodyBase.prompt = `${bodyBase.prompt} --version 7`.trim();
        }
        if (qualityToken) {
            bodyBase.quality = qualityToken;
            // 同时将 --quality 写入 prompt，便于和官方机器人展示一致。
            if (typeof bodyBase.prompt === "string" && !/\s--quality\s+\S+/i.test(bodyBase.prompt)) {
                bodyBase.prompt = `${bodyBase.prompt} --quality ${qualityToken}`.trim();
            }
        }
        if (typeof params.imageId === "string" && params.imageId.trim()) bodyBase.image_id = params.imageId.trim();
        if (typeof params.callbackUrl === "string" && params.callbackUrl.trim()) bodyBase.callback_url = params.callbackUrl.trim();

        const generatedUrls: string[] = [];
        let lastTaskId = "";
        for (let i = 0; i < count; i++) {
            const submitResult = await this.submitImagine({ ...bodyBase }, apiKey, apiUrl);
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
                lastTaskId = taskId;
                urls = await this.retrieveTask(taskId, apiKey, apiUrl);
            } else if (submitResult.taskId) {
                lastTaskId = submitResult.taskId;
            }

            // count > 1 时每次只取 1 张，确保“生成数量 N”得到 N 张而不是 N * 4 张。
            const picked = count > 1 ? urls.slice(0, 1) : urls;
            generatedUrls.push(...picked);
        }

        const images: string[] = [];
        for (const url of generatedUrls) {
            if (!url.startsWith("http") || ACE_RETURN_REMOTE_URL) {
                images.push(url);
            } else {
                try {
                    images.push(await this.downloadAndSaveImage(url));
                } catch (error: any) {
                    const status = error?.response?.status;
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
            original_id: lastTaskId || `midjourney_${Date.now()}`,
            images,
        };
    }
}

