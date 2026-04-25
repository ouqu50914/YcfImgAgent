/**
 * NanoAdapter - Ace Data Cloud Nano Banana Images API
 * 使用 ACE_API_KEY、ACE_API_URL 环境变量
 * 文档: https://platform.acedata.cloud/documents/nano-banana-images
 */
import { AiProvider, AiResponse, GenerateParams, UpscaleParams, ExtendParams, SplitParams } from "./ai-provider.interface";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import http from "http";
import https from "https";
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from "../services/cos.service";
import { detectImageFormat } from "../utils/image-format";
import { ProviderError } from "./provider-error";

const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });
const axiosClient = axios.create({
    proxy: false,
    httpAgent: keepAliveHttpAgent,
    httpsAgent: keepAliveHttpsAgent,
});

// 轮询间隔与最大等待时间（可通过环境变量覆盖）
const NANO_POLL_INTERVAL_MS = Number(process.env.ACE_NANO_POLL_INTERVAL_MS || "5000"); // 默认 5 秒
const NANO_MAX_WAIT_MS = Number(
    process.env.ACE_NANO_MAX_WAIT_MS || String(10 * 60 * 1000)
); // 默认 10 分钟
// Ace HTTP 请求超时时间（可通过 ACE_NANO_REQUEST_TIMEOUT_MS 覆盖），默认 10 分钟
const NANO_REQUEST_TIMEOUT_MS = Number(
    process.env.ACE_NANO_REQUEST_TIMEOUT_MS || String(10 * 60 * 1000)
);
// 调试开关：只打印请求，不真正调用 Ace，避免消耗 token
const NANO_DRY_RUN = process.env.ACE_NANO_DRY_RUN === "true";
// 直链模式：不下载 Ace 返回的图片，直接返回 Ace CDN URL 给前端，由浏览器直连 Ace，节省服务器带宽（适合 1M 等低带宽）
const ACE_RETURN_REMOTE_URL = process.env.ACE_RETURN_REMOTE_URL === "true";
const ACE_REQUEST_BODY_MAX_BYTES = 20 * 1024 * 1024; // 20MB

export class NanoAdapter implements AiProvider {
    /**
     * Ace 对请求体大小有限制。这里在调用上游前先做本地校验，
     * 避免用户在图片过多/过大时等待很久后才收到模糊错误。
     */
    private ensureRequestBodySize(body: Record<string, unknown>) {
        const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
        if (bytes > ACE_REQUEST_BODY_MAX_BYTES) {
            throw new ProviderError({
                code: "ACE_REQUEST_BODY_TOO_LARGE",
                status: 413,
                message: "请求主体超过 20MB，请减少上传图片数量或压缩图片大小后重试。",
                provider: "ace",
                transient: false,
            });
        }
    }

    private mapAceFailureToProviderError(rawMessage: string): ProviderError {
        const m = (rawMessage || "").trim();
        const lower = m.toLowerCase();
        if (
            lower.includes("queue being full") ||
            lower.includes("task queue is full") ||
            (lower.includes("queue") && lower.includes("full")) ||
            lower.includes("try again later") ||
            lower.includes("temporarily unavailable") ||
            lower.includes("service unavailable")
        ) {
            return new ProviderError({
                code: "ACE_UPSTREAM_BUSY",
                status: 503,
                message: `Ace 上游暂时不可用: ${m || "队列繁忙，请稍后重试"}`,
                provider: "ace",
                transient: true,
            });
        }
        if (lower.includes("failed to process image urls to base64")) {
            return new ProviderError({
                code: "ACE_IMAGE_URL_TO_BASE64_FAILED",
                status: 422,
                message: "参考图片处理失败：无法将图片 URL 转为 Base64。请检查参考图链接是否可公网访问、未过期且返回的是图片内容。",
                provider: "ace",
                transient: false,
            });
        }
        if (lower.includes("failed to process generated image") && lower.includes("no content available")) {
            return new ProviderError({
                code: "ACE_GENERATED_IMAGE_EMPTY",
                status: 502,
                message: "生成失败：上游返回的图片内容为空。请稍后重试；若持续出现，可更换参考图或降低分辨率/质量后再试。",
                provider: "ace",
                transient: true,
            });
        }
        if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("network")) {
            return new ProviderError({
                code: "ACE_TRANSIENT_NETWORK",
                status: 504,
                message: `Ace 网络波动或超时: ${m || "未知错误"}`,
                provider: "ace",
                transient: true,
            });
        }
        return new ProviderError({
            code: "ACE_TASK_FAILED",
            status: 502,
            message: `Ace 任务失败: ${m || "未知错误"}`,
            provider: "ace",
            transient: false,
        });
    }

    private formatAceErrorMessage(data: unknown, fallback: string): string {
        if (typeof data === "string" && data.trim()) return data;
        if (data && typeof data === "object") {
            const anyData = data as any;
            const msg =
                anyData?.error?.message ||
                anyData?.message ||
                anyData?.error?.error ||
                anyData?.error?.code ||
                anyData?.code;
            if (typeof msg === "string" && msg.trim()) return msg;
            try {
                return JSON.stringify(data);
            } catch {
                return fallback;
            }
        }
        return fallback;
    }

    private getBaseUrl(): string {
        const url = process.env.ACE_API_URL || "https://api.acedata.cloud";
        return url.replace(/\/$/, "");
    }

    private getApiKey(): string {
        const key = process.env.ACE_API_KEY;
        if (!key) throw new Error("ACE_API_KEY 环境变量未配置，请在 .env 中配置 Ace Data Cloud 的 API Key");
        return key;
    }

    private getEndpoint(): string {
        return `${this.getBaseUrl()}/nano-banana/images`;
    }

    private getHeaders(): Record<string, string> {
        return {
            "authorization": `Bearer ${this.getApiKey()}`,
            "accept": "application/json",
            "content-type": "application/json",
        };
    }

    private async downloadAndSaveImage(remoteUrl: string): Promise<string> {
        const startedAt = Date.now();
        const downloadStartedAt = Date.now();
        const res = await axiosClient.get(remoteUrl, {
            responseType: "arraybuffer",
            timeout: NANO_REQUEST_TIMEOUT_MS,
        });
        const downloadMs = Date.now() - downloadStartedAt;
        const buffer = Buffer.from(res.data);
        const ct = (res.headers as any)?.["content-type"];
        const pathname = (() => {
            try { return new URL(remoteUrl).pathname; } catch { return undefined; }
        })();
        const detectParams: { firstBytes: Buffer; contentTypeHeader?: string; urlPathname?: string } = {
            firstBytes: buffer.subarray(0, 32),
        };
        if (typeof ct === "string" && ct.trim()) detectParams.contentTypeHeader = ct;
        if (typeof pathname === "string" && pathname) detectParams.urlPathname = pathname;
        const detected = detectImageFormat(detectParams);
        const fileName = `nano_${uuidv4()}${detected.ext}`;

        const uploadStartedAt = Date.now();
        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, detected.mime);
            console.log("[NanoAdapter][Timing] download_and_save_done", {
                target: "cos",
                bytes: buffer.length,
                download_ms: downloadMs,
                upload_ms: Date.now() - uploadStartedAt,
                total_ms: Date.now() - startedAt,
                path: `/uploads/${fileName}`,
            });
            return `/uploads/${fileName}`;
        }
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        console.log("[NanoAdapter][Timing] download_and_save_done", {
            target: "local",
            bytes: buffer.length,
            download_ms: downloadMs,
            upload_ms: Date.now() - uploadStartedAt,
            total_ms: Date.now() - startedAt,
            path: `/uploads/${fileName}`,
        });
        return `/uploads/${fileName}`;
    }

    /** 判断是否为 Ace 服务器可访问的 HTTP(S) URL（排除 localhost） */
    private isPublicUrl(url: string): boolean {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
        try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            return host !== "localhost" && host !== "127.0.0.1";
        } catch {
            return false;
        }
    }

    /** 获取图片的 base64（/uploads/ 从 COS 或本地读，http 下载） */
    private async getImageBase64(imageInput: string): Promise<string> {
        if (imageInput.startsWith("data:")) {
            const m = imageInput.match(/^data:[^;]+;base64,(.+)$/);
            return (m?.[1] ?? imageInput) as string;
        }
        const pathPart = imageInput.startsWith("http") && imageInput.includes("/uploads/") ? new URL(imageInput).pathname : imageInput;
        if (pathPart.startsWith("/uploads/") || pathPart.includes("/uploads/")) {
            const pathNorm = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
            const buf = await getFileContent(pathNorm);
            return buf.toString("base64");
        }
        if (!imageInput.startsWith("http")) {
            const localPath = path.join(process.cwd(), imageInput.startsWith("/") ? imageInput.slice(1) : imageInput);
            if (fs.existsSync(localPath)) return fs.readFileSync(localPath).toString("base64");
        }
        if (imageInput.startsWith("http")) {
            const res = await axiosClient.get(imageInput, {
                responseType: "arraybuffer",
                timeout: NANO_REQUEST_TIMEOUT_MS,
            });
            return Buffer.from(res.data).toString("base64");
        }
        throw new Error(`无法获取图片: ${imageInput}`);
    }

    /**
     * 提交 Ace Nano Banana 任务。
     * 如果响应中直接包含 image_url，则视为同步完成；
     * 否则尝试提取 task_id，交由任务轮询处理。
     */
    private async submitTask(body: Record<string, unknown>): Promise<{ imageUrls?: string[]; taskId?: string }> {
        this.ensureRequestBodySize(body);
        if (NANO_DRY_RUN) {
            console.log("[NanoAdapter] DRY-RUN 模式：不会真正调用 Ace 接口。即将发送的请求：", {
                endpoint: this.getEndpoint(),
                body,
            });
            // 不发请求，直接返回一个空结果，让上层走「没有 image_url / task_id」的错误分支，提示仍然清晰
            throw new Error("Nano DRY-RUN 模式：仅打印请求体，未调用 Ace 接口。请关闭 ACE_NANO_DRY_RUN 后再正式生图。");
        }
        try {
            const res = await axiosClient.post(this.getEndpoint(), body, {
                headers: this.getHeaders(),
                timeout: NANO_REQUEST_TIMEOUT_MS,
            });

            const data = res.data;
            const urls = this.extractImageUrls(data);
            if (urls.length > 0) {
                console.log("[NanoAdapter] 提交 Ace 任务后同步返回图片", {
                    urlCount: urls.length,
                    firstUrl: urls[0],
                });
                return { imageUrls: urls };
            }

            const taskId: unknown =
                data?.task_id ||
                data?.taskId ||
                (Array.isArray(data?.data) ? undefined : data?.data?.task_id);

            if (typeof taskId === "string" && taskId.length > 0) {
                console.log("[NanoAdapter] 提交 Ace 任务成功", { taskId });
                return { taskId };
            }

            console.error("[NanoAdapter] 提交 Ace 任务返回未知结构:", JSON.stringify(data, null, 2));
            throw new Error("提交 Ace 任务失败：返回结果中既没有 image_url 也没有 task_id");
        } catch (error: any) {
            // 更详细地输出 Ace 返回的错误信息（尤其是 4xx）
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const data = error.response?.data;
                console.error("[NanoAdapter] 提交 Ace 任务请求失败", {
                    status,
                    data,
                    message: error.message,
                });
                // 有些情况下 Ace 可能返回 5xx，但同时给出 task_id（任务实际已创建）。
                // 仅当响应中没有显式 error 对象时，才认为任务已创建并转为轮询；
                // 像你贴的这种 { success:false, error:{message:...} } 视为任务失败，直接抛错给前端。
                const taskIdFromError: unknown = (data as any)?.task_id || (data as any)?.taskId;
                const aceErrorObj: unknown = (data as any)?.error;
                if (typeof taskIdFromError === "string" && taskIdFromError.length > 0 && !aceErrorObj) {
                    console.warn("[NanoAdapter] Ace 返回错误但包含 task_id，转为轮询任务", {
                        status,
                        taskId: taskIdFromError,
                    });
                    return { taskId: taskIdFromError };
                }
                const msg = this.formatAceErrorMessage(data, error.message);
                // 429/5xx 优先标记为可恢复，服务层可决定重试或切换 AnyFast
                if (typeof status === "number" && (status === 429 || status >= 500)) {
                    throw new ProviderError({
                        code: status === 429 ? "ACE_RATE_LIMITED" : "ACE_UPSTREAM_5XX",
                        status,
                        message: `Ace 上游暂时不可用: ${msg}`,
                        provider: "ace",
                        transient: true,
                    });
                }
                // 其它错误统一映射（多数为请求本身问题）
                throw this.mapAceFailureToProviderError(msg);
            }
            throw error;
        }
    }

    /**
     * 轮询任务状态，直到拿到图片 URL 或超时/失败。
     */
    private async waitForTask(
        taskId: string,
        options?: { pollIntervalMs?: number; maxWaitMs?: number }
    ): Promise<string[]> {
        const pollIntervalMs = options?.pollIntervalMs ?? NANO_POLL_INTERVAL_MS;
        const maxWaitMs = options?.maxWaitMs ?? NANO_MAX_WAIT_MS;
        const start = Date.now();
        const baseUrl = this.getBaseUrl();
        // 官方控制台示例：POST /nano-banana/tasks，body: { id: taskId }
        const nanoTasksEndpoint = `${baseUrl}/nano-banana/tasks`;
        // 可选：如果你确实开通了 seedance 通用任务接口，可通过环境变量开启备用查询路径。
        const seedanceEndpoint = process.env.ACE_NANO_TASK_RETRIEVE_URL?.trim();
        const legacyGetTemplate = process.env.ACE_NANO_TASK_STATUS_URL_TEMPLATE;

        while (true) {
            const elapsed = Date.now() - start;
            if (elapsed > maxWaitMs) {
                throw new ProviderError({
                    code: "ACE_TASK_TIMEOUT",
                    status: 504,
                    message: "Ace 任务超时（超过10分钟未完成）",
                    provider: "ace",
                    transient: true,
                });
            }

            let data: any;
            try {
                // 1) 按 Nano 官方示例：POST /nano-banana/tasks { id }
                const res = await axiosClient.post(
                    nanoTasksEndpoint,
                    { id: taskId },
                    {
                        headers: this.getHeaders(),
                        timeout: NANO_REQUEST_TIMEOUT_MS,
                    }
                );
                data = res.data;
            } catch (error: any) {
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    const respData = error.response?.data;
                    // 如果 /nano-banana/tasks 不存在或无权限，可选地走 seedance 或自定义 GET 模板（仅在显式配置时启用）。
                    if ((status === 404 || status === 401) && (seedanceEndpoint || legacyGetTemplate)) {
                        // 1) seedance/tasks 备用
                        if (seedanceEndpoint) {
                            try {
                                console.warn("[NanoAdapter] /nano-banana/tasks 调用失败，尝试 seedance/tasks", {
                                    taskId,
                                    status,
                                    data: respData,
                                });
                                const r = await axiosClient.post(
                                    seedanceEndpoint,
                                    { ids: [taskId], action: "retrieve_batch" },
                                    {
                                        headers: this.getHeaders(),
                                        timeout: NANO_REQUEST_TIMEOUT_MS,
                                    }
                                );
                                data = r.data;
                            } catch (e: any) {
                                if (!(axios.isAxiosError(e) && e.response?.status === 404)) {
                                    throw e;
                                }
                            }
                        }
                        // 2) 自定义 GET 模板
                        if (!data && legacyGetTemplate) {
                            const endpoint = legacyGetTemplate
                                .replace("{taskId}", taskId)
                                .replace("${taskId}", taskId);
                            try {
                                console.warn("[NanoAdapter] /nano-banana/tasks 调用失败，尝试自定义 GET 轮询", {
                                    taskId,
                                    endpoint,
                                    status,
                                    data: respData,
                                });
                                const r = await axiosClient.get(endpoint, {
                                    headers: this.getHeaders(),
                                    timeout: NANO_REQUEST_TIMEOUT_MS,
                                });
                                data = r.data;
                            } catch (e: any) {
                                if (axios.isAxiosError(e) && e.response?.status === 404) {
                                    await new Promise((resolve) =>
                                        setTimeout(resolve, Math.min(500, pollIntervalMs))
                                    );
                                    continue;
                                }
                                throw e;
                            }
                        }
                        if (!data) {
                            const msg = this.formatAceErrorMessage(respData, error.message);
                            throw new ProviderError({
                                code: "ACE_TASK_POLL_FAILED",
                                status: status ?? 502,
                                message: `轮询 Ace 任务失败 (${status ?? "未知状态"}): ${msg}`,
                                provider: "ace",
                                transient: typeof status === "number" && status >= 500,
                            });
                        }
                    } else {
                        console.error("[NanoAdapter] 轮询 Ace 任务请求失败", {
                            taskId,
                            status,
                            data: respData,
                            message: error.message,
                        });
                        const msg = this.formatAceErrorMessage(respData, error.message);
                        throw new ProviderError({
                            code: "ACE_TASK_POLL_FAILED",
                            status: status ?? 502,
                            message: `轮询 Ace 任务失败 (${status ?? "未知状态"}): ${msg}`,
                            provider: "ace",
                            transient: (status === 429) || (typeof status === "number" && status >= 500),
                        });
                    }
                }
                throw error;
            }

            const urls = this.extractImageUrls(data);
            // 兼容：任务状态字段可能出现在多层嵌套中
            const rawStatus: unknown =
                data?.status ||
                data?.task_status ||
                data?.state ||
                data?.items?.[0]?.status ||
                data?.items?.[0]?.state ||
                data?.items?.[0]?.response?.status ||
                data?.items?.[0]?.response?.state ||
                data?.items?.[0]?.response?.task_status ||
                data?.items?.[0]?.response?.taskStatus ||
                data?.items?.[0]?.response?.data?.status ||
                data?.items?.[0]?.response?.data?.state ||
                data?.items?.[0]?.response?.data?.task_status ||
                data?.items?.[0]?.response?.data?.taskStatus ||
                data?.data?.[0]?.status ||
                data?.data?.[0]?.state ||
                data?.data?.[0]?.task_status ||
                data?.data?.[0]?.taskStatus;
            const status = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";

            console.log("[NanoAdapter] 轮询 Ace 任务状态", {
                taskId,
                status,
                hasImage: urls.length > 0,
            });

            if (urls.length > 0) {
                return urls;
            }

            // 显式错误：兼容不同返回结构（有些失败只给 message）
            // 优先使用 items[0].response；若不存在，则回退到顶层 response（与你贴的示例结构一致）
            const resp0 = data?.items?.[0]?.response ?? data?.response;
            const explicitError: unknown =
                data?.error ||
                data?.items?.[0]?.error ||
                resp0?.error ||
                resp0?.data?.error;

            // 尝试从尽可能多的位置提取失败 message（Ace 的结构经常变化）
            const messageCandidates: unknown[] = [
                data?.message,
                data?.msg,
                data?.data?.message,
                data?.data?.msg,
                data?.items?.[0]?.message,
                data?.items?.[0]?.msg,
                resp0?.message,
                resp0?.msg,
                resp0?.data?.message,
                resp0?.data?.msg,
                resp0?.error?.message,
                resp0?.data?.error?.message,
            ];
            // 有些返回会把 message 放在顶层 data[] 的每个元素里
            if (Array.isArray(data?.data)) {
                for (const it of data.data) {
                    if (!it) continue;
                    messageCandidates.push((it as any)?.message);
                    messageCandidates.push((it as any)?.msg);
                    messageCandidates.push((it as any)?.error);
                    messageCandidates.push((it as any)?.error?.message);
                }
            }
            // 有些返回会把 message 放在 response.data[] 的每个元素里
            if (Array.isArray(resp0?.data)) {
                for (const it of resp0.data) {
                    if (!it) continue;
                    messageCandidates.push((it as any)?.message);
                    messageCandidates.push((it as any)?.msg);
                    messageCandidates.push((it as any)?.error);
                    messageCandidates.push((it as any)?.error?.message);
                }
            }
            const explicitMessage: unknown = messageCandidates.find(
                (v) => typeof v === "string" && (v as string).trim().length > 0
            );

            const explicitOkFlag: unknown =
                (data as any)?.success === false ||
                (data as any)?.ok === false ||
                resp0?.success === false ||
                resp0?.ok === false ||
                resp0?.data?.success === false ||
                resp0?.data?.ok === false;

            if (explicitError) {
                const msg = this.formatAceErrorMessage(explicitError, "Ace 任务失败");
                throw new Error(`Ace 任务失败: ${msg}`);
            }

            // 有些接口失败不会带 error 字段，但 message 会直接包含 Failed / Error 等关键字
            if (typeof explicitMessage === "string" && explicitMessage.trim()) {
                const m = explicitMessage.trim();
                const lower = m.toLowerCase();
                if (explicitOkFlag || lower.includes("failed") || lower.includes("error") || lower.includes("cancel")) {
                    throw this.mapAceFailureToProviderError(m);
                }
            }

            // 失败状态（通过状态字符串判断）
            if (
                status.includes("fail") ||
                status.includes("error") ||
                status.includes("cancel")
            ) {
                const msg: unknown = explicitMessage || data?.error || rawStatus || "未知错误";
                const m = String(msg);
                throw this.mapAceFailureToProviderError(m);
            }

            // 其它状态（pending / running / queued / processing 等）视为仍在进行中
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    private extractImageUrls(res: any): string[] {
        const urls: string[] = [];

        // 1) 常规结构：data.url / data.urls[]
        if (res?.data?.url) urls.push(res.data.url);
        if (res?.data?.urls && Array.isArray(res.data.urls)) urls.push(...res.data.urls);

        // 2) data 为数组（Ace Nano Banana 当前返回）
        if (Array.isArray(res?.data)) {
            for (const item of res.data) {
                if (!item) continue;
                if (typeof item.image_url === "string") {
                    urls.push(item.image_url);
                } else if (typeof item.url === "string") {
                    urls.push(item.url);
                }
            }
        }

        // 2.5) seedance/tasks retrieve_batch：items[].response.data[].image_url
        if (Array.isArray(res?.items)) {
            for (const it of res.items) {
                const resp = it?.response;
                if (Array.isArray(resp?.data)) {
                    for (const d of resp.data) {
                        if (d && typeof d.image_url === "string") urls.push(d.image_url);
                        if (d && typeof d.imageUrl === "string") urls.push(d.imageUrl);
                        if (d && typeof d.url === "string") urls.push(d.url);
                        if (d && typeof d.image === "string") urls.push(d.image);
                    }
                }
                if (typeof resp?.image_url === "string") urls.push(resp.image_url);
                if (typeof resp?.imageUrl === "string") urls.push(resp.imageUrl);
            }
        }

        // 3) 顶层就是数组
        if (Array.isArray(res)) {
            for (const item of res) {
                if (!item) continue;
                if (typeof item.image_url === "string") {
                    urls.push(item.image_url);
                } else if (typeof item.url === "string") {
                    urls.push(item.url);
                }
            }
        }

        // 4) 其它兼容字段
        if (res?.images && Array.isArray(res.images)) urls.push(...res.images);
        if (res?.result?.images && Array.isArray(res.result.images)) urls.push(...res.result.images);

        // 去重 & 只保留非空字符串
        const unique = Array.from(
            new Set(
                urls.filter((u) => typeof u === "string" && u.length > 0)
            )
        );
        return unique;
    }

    /**
     * 规范化 & 校验模型名，只允许 nano-banana-2 / nano-banana-pro，自动去除前后空格。
     * 若不合法则抛错，避免把错误的 model 传给 Ace。
     */
    private normalizeModel(model?: string): string | undefined {
        if (!model) return undefined;
        const trimmed = model.trim();
        if (trimmed === "nano-banana-2" || trimmed === "nano-banana-pro") {
            return trimmed;
        }
        throw new Error(`无效的 Nano 模型: ${model}，仅支持 nano-banana-2 或 nano-banana-pro`);
    }

    // 分辨率说明：
    // 目前按照 Ace 官方示例，统一使用 resolution 字段，并直接透传 1K/2K/4K，
    // 不在服务端换算成具体像素尺寸。

    async generateImage(params: GenerateParams, _apiKey: string, _apiUrl: string): Promise<AiResponse> {
        // 前端仍然可以传 numImages，这里只用来决定是否并发多次调用，不再透传到 Ace（不发送 count 字段）
        const count = params.num_images || (params as any).numImages || 1;
        const hasImage = !!params.imageUrl || (params.imageUrls && params.imageUrls.length > 0);

        if (count > 1) {
            const tasks = Array(Math.min(count, 4)).fill(0).map(() =>
                this.generateImage({ ...params, num_images: 1, numImages: 1 } as any, "", "")
            );
            const results = await Promise.all(tasks);
            const allUrls: string[] = [];
            for (const r of results) {
                if (r.images?.length) allUrls.push(...r.images);
            }
            if (allUrls.length === 0) throw new Error("并发生成全部失败");
            return { original_id: `nano_${Date.now()}`, images: allUrls };
        }

        // 根据提示词中的 @图X、参考图片数量与前端传入的图片别名，构造带别名说明的 prompt
        const imageCountForAlias =
            (params.imageUrls && params.imageUrls.length > 0)
                ? params.imageUrls.length
                : params.imageUrl
                ? 1
                : 0;

        const imageAliasesFromFront = (params as any).imageAliases as number[] | undefined;

        let promptWithAliases = this.buildPromptWithAliases(
            (params.prompt || "生成图片") as string,
            imageCountForAlias,
            imageAliasesFromFront
        );

        // Ace 文档中 action 默认为 generate，这里仅在图生图时显式设置为 edit，
        // 文生图则不传 action 字段，交给服务端使用默认行为。
        const body: Record<string, unknown> = {};
        if (hasImage) {
            body.action = "edit";
        }

        // 选择 Ace 模型：仅支持 nano-banana-2 / nano-banana-pro
        const model = this.normalizeModel((params as any).model as string | undefined);
        if (model) {
            body.model = model;
        }

        // 分辨率/比例处理：
        // - 文生图：resolution 直接透传 1K/2K/4K，aspect_ratio 也透传，不再写进提示词
        // - 图生图：resolution 透传 1K/2K/4K，aspect_ratio 单独透传
        const quality = params.quality && ["1K", "2K", "4K"].includes(params.quality) ? params.quality : undefined;

        if (!hasImage) {
            if (quality) {
                body.resolution = quality;
            }
            if (params.aspectRatio) {
                body.aspect_ratio = params.aspectRatio;
            }
        } else {
            // 图生图：resolution + aspect_ratio
            if (quality) {
                body.resolution = quality;
            }
            if (params.aspectRatio) {
                body.aspect_ratio = params.aspectRatio;
            }
        }

        body.prompt = promptWithAliases;

        // 参考图片：支持单张 imageUrl 或多张 imageUrls（行为与 Seedream 类似）
        if (hasImage) {
            const allUrls: string[] = [];
            if (params.imageUrls && params.imageUrls.length > 0) {
                for (const u of params.imageUrls) {
                    if (!u) continue;
                    if (this.isPublicUrl(u)) {
                        allUrls.push(u.trim());
                    } else {
                        const base64 = await this.getImageBase64(u);
                        allUrls.push(`data:image/png;base64,${base64}`);
                    }
                }
            } else if (params.imageUrl) {
                const u = params.imageUrl;
                if (this.isPublicUrl(u)) {
                    allUrls.push(u.trim());
                } else {
                    const base64 = await this.getImageBase64(u);
                    allUrls.push(`data:image/png;base64,${base64}`);
                }
            }

            if (allUrls.length === 0) {
                throw new Error("缺少参考图片");
            }
            body.image_urls = allUrls;
        }

        // 打印请求概览（不包含 base64）
        const logBody: Record<string, unknown> = { ...body };
        if ("image" in logBody) {
            logBody.image = "[base64 omitted]";
        }
        console.log("[NanoAdapter] 准备调用 Ace 生图", {
            endpoint: this.getEndpoint(),
            body: logBody,
        });

        // 1) 提交任务
        const submitResult = await this.submitTask(body);
        let remoteUrls: string[];

        if (submitResult.imageUrls && submitResult.imageUrls.length > 0) {
            // 同步返回结果
            remoteUrls = submitResult.imageUrls;
            console.log("[NanoAdapter] Ace 生图同步完成", {
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else if (submitResult.taskId) {
            // 2) 轮询任务结果
            console.log("[NanoAdapter] 开始轮询 Ace 生图任务", {
                taskId: submitResult.taskId,
            });
            remoteUrls = await this.waitForTask(submitResult.taskId, {
                pollIntervalMs: NANO_POLL_INTERVAL_MS,
                maxWaitMs: NANO_MAX_WAIT_MS,
            });
            console.log("[NanoAdapter] Ace 生图任务完成", {
                taskId: submitResult.taskId,
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else {
            throw new Error("Ace 生图失败：既没有 image_url 也没有 task_id");
        }

        return {
            original_id: `nano_${Date.now()}`,
            images: await Promise.all(
                remoteUrls.map((url) =>
                    url.startsWith("http") ? this.downloadAndSaveImage(url) : url
                )
            ),
        };
    }

    /**
     * 将用户的 prompt 与图片数量结合，生成包含别名说明的提示词：
     * 例如：图1 对应第 1 张图片；图2 对应第 2 张图片……
     * 这样模型在看到 @图1/@图2 时，就能知道对应的是哪一张参考图。
     */
    private buildPromptWithAliases(originalPrompt: string, imageCount: number, imageAliases?: number[]): string {
        const base = originalPrompt || "生成图片";
        if (!imageCount || imageCount <= 0) return base;

        // 1) 如果前端显式传入了 imageAliases（与 imageUrls 对齐），优先使用该映射：
        //    第 i 张图片对应别名 图{imageAliases[i]}。
        const aliasesFromParam = Array.isArray(imageAliases)
            ? imageAliases.filter((n) => typeof n === "number" && n > 0)
            : [];

        if (aliasesFromParam.length > 0) {
            const pairsFromParam: { alias: number; index: number }[] = [];
            for (let i = 0; i < imageCount; i++) {
                const alias = aliasesFromParam[i] ?? i + 1;
                pairsFromParam.push({ alias, index: i + 1 });
            }

            const aliasDescFromParam = pairsFromParam
                .map((p) => `图${p.alias} 对应第 ${p.index} 张图片`)
                .join("；");

            return `有多张参考图片：${aliasDescFromParam}。下面是用户的详细描述：${base}`;
        }

        // 2) 兼容旧逻辑：从原始 prompt 中自动解析 @图N，并按照出现顺序映射到图片序号。
        const used = new Set<number>();
        const regex = /@图(\d+)/g;
        let match: RegExpExecArray | null;

        // 收集用户实际使用过的别名编号（不再强制限制在 1..imageCount 内）
        while ((match = regex.exec(base)) !== null) {
            const raw = match[1];
            if (!raw) continue;
            const n = parseInt(raw, 10);
            if (Number.isNaN(n) || n <= 0) continue;
            used.add(n);
        }

        // 如果用户没有写任何 @图X，则默认使用 1..imageCount 作为别名编号
        if (used.size === 0) {
            for (let i = 1; i <= imageCount; i++) {
                used.add(i);
            }
        }

        const sorted = Array.from(used).sort((a, b) => a - b);

        // 将「出现顺序」与「图片下标」对齐：
        // 例如用户只写了 @图4 @图5，且有 2 张参考图，则：
        // 图4 -> 第 1 张图片；图5 -> 第 2 张图片
        const pairs: { alias: number; index: number }[] = [];
        let idx = 1;
        for (const alias of sorted) {
            if (idx > imageCount) break;
            pairs.push({ alias, index: idx });
            idx++;
        }

        // 理论上不应该出现，但兜底处理：如果 pairs 为空，则退回 1..imageCount 对应关系
        if (pairs.length === 0) {
            for (let i = 1; i <= imageCount; i++) {
                pairs.push({ alias: i, index: i });
            }
        }

        const aliasDesc = pairs
            .map((p) => `图${p.alias} 对应第 ${p.index} 张图片`)
            .join("；");

        return `有多张参考图片：${aliasDesc}。下面是用户的详细描述：${base}`;
    }

    async upscaleImage(params: UpscaleParams, _apiKey: string, _apiUrl: string): Promise<AiResponse> {
        const scale = params.scale || 2;
        const body: Record<string, unknown> = {
            action: "edit",
            prompt: `保持原图风格和内容，提高分辨率和细节，放大 ${scale} 倍`,
        };

        const model = this.normalizeModel((params as any).model as string | undefined);
        if (model) {
            body.model = model;
        }

        if (this.isPublicUrl(params.imageUrl)) {
            body.image_urls = [params.imageUrl];
        } else {
            const base64 = await this.getImageBase64(params.imageUrl);
            body.image_urls = [`data:image/png;base64,${base64}`];
        }
        // 放大场景也使用 size 字段
        if (scale === 4) body.size = "4K";
        else body.size = "2K";

        const logBody: Record<string, unknown> = { ...body };
        if ("image" in logBody) {
            logBody.image = "[base64 omitted]";
        }
        console.log("[NanoAdapter] 准备调用 Ace 放大", {
            endpoint: this.getEndpoint(),
            body: logBody,
        });

        const submitResult = await this.submitTask(body);
        let remoteUrls: string[];

        if (submitResult.imageUrls && submitResult.imageUrls.length > 0) {
            remoteUrls = submitResult.imageUrls;
            console.log("[NanoAdapter] Ace 放大同步完成", {
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else if (submitResult.taskId) {
            console.log("[NanoAdapter] 开始轮询 Ace 放大任务", {
                taskId: submitResult.taskId,
            });
            remoteUrls = await this.waitForTask(submitResult.taskId, {
                pollIntervalMs: NANO_POLL_INTERVAL_MS,
                maxWaitMs: NANO_MAX_WAIT_MS,
            });
            console.log("[NanoAdapter] Ace 放大任务完成", {
                taskId: submitResult.taskId,
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else {
            throw new Error("Ace 放大失败：既没有 image_url 也没有 task_id");
        }

        const first = remoteUrls[0];
        if (!first) throw new Error("Ace 放大失败：未获取到图片 URL");
        const local = first.startsWith("http") && !ACE_RETURN_REMOTE_URL
            ? await this.downloadAndSaveImage(first)
            : first;
        return { original_id: `nano_upscale_${Date.now()}`, images: [local] };
    }

    async extendImage(params: ExtendParams, _apiKey: string, _apiUrl: string): Promise<AiResponse> {
        const dirMap: Record<string, string> = {
            top: "向上",
            bottom: "向下",
            left: "向左",
            right: "向右",
            all: "向四周",
        };
        const dir = dirMap[params.direction] || "向右";
        const prompt = params.prompt || `${dir}扩展画面，保持风格一致，无缝衔接`;
        const body: Record<string, unknown> = {
            action: "edit",
            prompt,
        };
        if (params.ratio && params.ratio !== "auto") body.aspect_ratio = params.ratio;

        const model = this.normalizeModel((params as any).model as string | undefined);
        if (model) {
            body.model = model;
        }

        const imgUrl = params.imageUrl;
        if (!imgUrl) throw new Error("缺少图片 URL");
        if (this.isPublicUrl(imgUrl)) {
            body.image_urls = [imgUrl];
        } else {
            const base64 = await this.getImageBase64(imgUrl);
            body.image_urls = [`data:image/png;base64,${base64}`];
        }

        const logBody: Record<string, unknown> = { ...body };
        if ("image" in logBody) {
            logBody.image = "[base64 omitted]";
        }
        console.log("[NanoAdapter] 准备调用 Ace 扩展", {
            endpoint: this.getEndpoint(),
            body: logBody,
        });

        const submitResult = await this.submitTask(body);
        let remoteUrls: string[];

        if (submitResult.imageUrls && submitResult.imageUrls.length > 0) {
            remoteUrls = submitResult.imageUrls;
            console.log("[NanoAdapter] Ace 扩展同步完成", {
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else if (submitResult.taskId) {
            console.log("[NanoAdapter] 开始轮询 Ace 扩展任务", {
                taskId: submitResult.taskId,
            });
            remoteUrls = await this.waitForTask(submitResult.taskId, {
                pollIntervalMs: NANO_POLL_INTERVAL_MS,
                maxWaitMs: NANO_MAX_WAIT_MS,
            });
            console.log("[NanoAdapter] Ace 扩展任务完成", {
                taskId: submitResult.taskId,
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else {
            throw new Error("Ace 扩展失败：既没有 image_url 也没有 task_id");
        }

        const first = remoteUrls[0];
        if (!first) throw new Error("Ace 扩展失败：未获取到图片 URL");
        const local = first.startsWith("http") && !ACE_RETURN_REMOTE_URL
            ? await this.downloadAndSaveImage(first)
            : first;
        return { original_id: `nano_extend_${Date.now()}`, images: [local] };
    }

    async splitImage(params: SplitParams, _apiKey: string, _apiUrl: string): Promise<AiResponse> {
        const count = params.splitCount || 2;
        const dir = params.splitDirection === "vertical" ? "垂直" : "水平";
        const prompt = params.prompt || `将图片${dir}拆分为${count}个部分，保持每个部分的内容完整和连贯性`;

        const body: Record<string, unknown> = {
            action: "edit",
            prompt,
        };

        const model = this.normalizeModel((params as any).model as string | undefined);
        if (model) {
            body.model = model;
        }

        const imgUrl = params.imageUrl;
        if (!imgUrl) throw new Error("缺少图片 URL");
        if (this.isPublicUrl(imgUrl)) {
            body.image_urls = [imgUrl];
        } else {
            const base64 = await this.getImageBase64(imgUrl);
            body.image_urls = [`data:image/png;base64,${base64}`];
        }

        const logBody: Record<string, unknown> = { ...body };
        if ("image" in logBody) {
            logBody.image = "[base64 omitted]";
        }
        console.log("[NanoAdapter] 准备调用 Ace 拆分", {
            endpoint: this.getEndpoint(),
            body: logBody,
        });

        const submitResult = await this.submitTask(body);
        let remoteUrls: string[];

        if (submitResult.imageUrls && submitResult.imageUrls.length > 0) {
            remoteUrls = submitResult.imageUrls;
            console.log("[NanoAdapter] Ace 拆分同步完成", {
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else if (submitResult.taskId) {
            console.log("[NanoAdapter] 开始轮询 Ace 拆分任务", {
                taskId: submitResult.taskId,
            });
            remoteUrls = await this.waitForTask(submitResult.taskId, {
                pollIntervalMs: NANO_POLL_INTERVAL_MS,
                maxWaitMs: NANO_MAX_WAIT_MS,
            });
            console.log("[NanoAdapter] Ace 拆分任务完成", {
                taskId: submitResult.taskId,
                urlCount: remoteUrls.length,
                firstUrl: remoteUrls[0],
            });
        } else {
            throw new Error("Ace 拆分失败：既没有 image_url 也没有 task_id");
        }

        const first = remoteUrls[0];
        if (!first) throw new Error("Ace 拆分失败：未获取到图片 URL");
        const local = first.startsWith("http") && !ACE_RETURN_REMOTE_URL
            ? await this.downloadAndSaveImage(first)
            : first;
        return { original_id: `nano_split_${Date.now()}`, images: [local] };
    }
}
