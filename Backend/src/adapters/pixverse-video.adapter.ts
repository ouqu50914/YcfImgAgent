import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { allocPixverseRefName, normalizeFusionPromptForPixverse } from "../utils/pixverse-ref-name";

const axiosClient = axios.create({ proxy: false });

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} 环境变量未配置，请在 Backend/.env 或运行环境中配置 PixVerse 相关参数`);
    }
    return value;
}

function getBaseUrl(): string {
    return (process.env.PIXVERSE_API_BASE_URL ?? "https://app-api.pixverseai.cn").replace(/\/$/, "");
}

export type PixverseVideoQuality = "540p" | "720p" | "1080p";

export interface PixverseCreateTextGenerateInput {
    aspect_ratio: "16:9" | "9.16" | "4:3" | "3:4" | "1:1" | string;
    duration: number; // 1~15（v6 文档口径）
    model?: string; // 默认 v6
    prompt: string;
    quality: PixverseVideoQuality | string; // 540p/720p/1080p
    generate_audio_switch?: boolean; // 默认 true
}

export interface PixverseCreateTextGenerateResult {
    video_id: number;
    credits?: number | null;
}

export interface PixverseCreateTransitionGenerateFromUrlsInput {
    firstImageUrl: string;
    lastImageUrl: string;
    prompt: string;
    aspect_ratio?: string; // PixVerse 转场接口未必需要；这里保留向后兼容
    duration: number;
    quality: PixverseVideoQuality | string;
    model?: string;
    generate_audio_switch?: boolean;
}

export interface PixverseCreateFusionGenerateFromUrlsInput {
    imageUrls: string[]; // 2~7
    /** 与 imageUrls 同序，对应各图的 ref_name（画布图片节点别名）；不传则 ref1/ref2… */
    refNames?: string[];
    /** 与 imageUrls 同序：画布「图N」中的 N，用于 @图4 → 该张图对应的 ref_name */
    figureNumbers?: number[];
    prompt: string;
    aspect_ratio: string;
    duration: number; // 上游支持 5/8/10（v5.6）
    quality: PixverseVideoQuality | string;
    model?: string;
    generate_audio_switch?: boolean;
}

export interface PixverseUploadImageResult {
    img_id: number;
    img_url?: string | null;
}

export interface PixverseGetVideoResult {
    status: number; // 1/5/7/8
    videoUrl?: string | null;
    errorMessage?: string | null;
    prompt?: string | null;
    negative_prompt?: string | null;
    seed?: number | null;
    style?: string | null;
    outputWidth?: number | null;
    outputHeight?: number | null;
}

function normalizePixverseMediaUrl(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) return null;
    // PixVerse 返回的 url 里可能把路径分隔符编码成 %2F，部分 CDN/OSS 会导致对象查找失败（404）。
    // 这里做一次解码归一化，确保最终是标准路径形式。
    try {
        if (s.includes("%2F") || s.includes("%2f")) {
            return decodeURIComponent(s);
        }
    } catch {
        // ignore decode errors and fallback
    }
    return s;
}

function withCacheBust(url: string): string {
    // 避免命中 CDN 的 404 负缓存；只在我们确认可访问时再加也行。
    const ts = Date.now();
    return url.includes("?") ? `${url}&_ts=${ts}` : `${url}?_ts=${ts}`;
}

async function probeMediaUrlAccessible(url: string, opts?: { maxAttempts?: number }): Promise<{ ok: boolean; status?: number }> {
    // 某些对象存储/CDN 不支持 HEAD；用一个极小的 Range GET 探测可访问性。
    // 另外，CDN 可能存在“对象已生成但边缘未就绪/负缓存 404”的短窗口，做带退避的重试能显著降低偶发 404。
    const maxAttempts = Math.min(6, Math.max(1, Number(opts?.maxAttempts ?? 4)));
    const baseDelayMs = 350;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const probeUrl = attempt === 1 ? url : withCacheBust(url);
        try {
            const res = await axiosClient.get(probeUrl, {
                timeout: 15000,
                responseType: "arraybuffer",
                headers: {
                    Range: "bytes=0-1",
                },
                // 允许我们拿到 4xx/5xx 来判断
                validateStatus: () => true,
            });

            const status = res.status;
            // 200/206/3xx 都认为可访问（3xx 由浏览器/客户端自行跟随）
            const ok = (status >= 200 && status < 300) || (status >= 300 && status < 400);
            if (ok) return { ok: true, status };

            // 403/401 通常是权限/防盗链，重试意义不大；直接失败
            if (status === 401 || status === 403) return { ok: false, status };

            // 404/5xx：可能是 CDN 尚未就绪或命中负缓存，做退避重试
            if (attempt < maxAttempts && (status === 404 || status >= 500)) {
                const delayMs = Math.min(4000, Math.round(baseDelayMs * Math.pow(1.8, attempt - 1)));
                await new Promise<void>((r) => setTimeout(r, delayMs));
                continue;
            }

            return { ok: false, status };
        } catch {
            if (attempt < maxAttempts) {
                const delayMs = Math.min(4000, Math.round(baseDelayMs * Math.pow(1.8, attempt - 1)));
                await new Promise<void>((r) => setTimeout(r, delayMs));
                continue;
            }
            return { ok: false };
        }
    }

    return { ok: false };
}

function maskPixverseHeaders(headers: Record<string, any> | undefined | null) {
    const h: Record<string, any> = { ...(headers || {}) };
    if (typeof h["API-KEY"] === "string" && h["API-KEY"]) h["API-KEY"] = "***";
    return h;
}

function logPixverseHttp(event: string, data: Record<string, any>) {
    // 目标：在后端打印出“类似前端 Network”的关键信息（method/url/headers/body/status/ErrCode/ErrMsg）
    // 注意：必须脱敏 API-KEY
    try {
        console.log(`[PixVerseHTTP] ${event}`, data);
    } catch {
        // ignore
    }
}

export class PixverseVideoAdapter {
    private getApiKey(): string {
        return getRequiredEnv("PIXVERSE_API_KEY");
    }

    private getDefaultModel(): string {
        return process.env.PIXVERSE_MODEL || "v6";
    }

    private buildHeaders(traceId: string) {
        return {
            "API-KEY": this.getApiKey(),
            // 文档里 header 字段大小写不完全一致：Ai-trace-id / Ai-Trace-Id
            // 这里两者都带，避免网关对大小写/命名做了严格校验。
            "Ai-trace-id": traceId,
            "Ai-Trace-Id": traceId,
            "Content-Type": "application/json",
        };
    }

    async createTextGenerate(input: PixverseCreateTextGenerateInput): Promise<PixverseCreateTextGenerateResult> {
        const url = `${getBaseUrl()}/openapi/v2/video/text/generate`;

        const traceId = uuidv4();
        const payload: Record<string, any> = {
            aspect_ratio: input.aspect_ratio,
            duration: input.duration,
            model: input.model || this.getDefaultModel(),
            prompt: input.prompt,
            quality: input.quality,
            generate_audio_switch: input.generate_audio_switch ?? true,
            // 未指定负面词/特效等字段，保持最小集
        };

        try {
            logPixverseHttp("request", {
                api: "video/text/generate",
                method: "POST",
                url,
                traceId,
                headers: maskPixverseHeaders(this.buildHeaders(traceId)),
                body: { ...payload, prompt: payload.prompt ? `${String(payload.prompt).slice(0, 80)}...` : "" },
            });
            const res = await axiosClient.post(url, payload, {
                headers: this.buildHeaders(traceId),
                timeout: 120000,
            });
            const data = res.data;
            logPixverseHttp("response", {
                api: "video/text/generate",
                method: "POST",
                url,
                traceId,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });

            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                const msg = typeof errMsg === "string" && errMsg ? errMsg : `PixVerse create failed (ErrCode=${errCode})`;
                const e: any = new Error(msg);
                e.code = "PIXVERSE_CREATE_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const videoIdRaw = resp?.video_id ?? resp?.videoId ?? resp?.video_id ?? resp?.id;
            const credits = resp?.credits ?? null;

            const videoIdNum = Number(videoIdRaw);
            if (!Number.isFinite(videoIdNum)) {
                const e: any = new Error("PixVerse 返回缺少有效的 video_id");
                e.raw = data;
                throw e;
            }

            return { video_id: videoIdNum, credits };
        } catch (error: any) {
            // 让 controller 统一做积分回滚/错误封装
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async uploadImageToGetImgId(imageUrl: string, traceId?: string): Promise<PixverseUploadImageResult> {
        const url = `${getBaseUrl()}/openapi/v2/image/upload`;
        const realTraceId = traceId ?? uuidv4();

        // PixVerse 单张图片限制：<= 20MB。若能从 URL 响应头拿到 Content-Length，则在上传前提前校验。
        // 文档口径：https://docs.platform.pai.video/6740019m0
        try {
            if (/^https?:\/\//i.test(imageUrl)) {
                const headRes = await axiosClient.head(imageUrl, {
                    timeout: 15000,
                    maxRedirects: 3,
                    validateStatus: () => true,
                });
                const lenRaw = headRes?.headers?.["content-length"];
                const len = typeof lenRaw === "string" ? Number(lenRaw) : typeof lenRaw === "number" ? lenRaw : NaN;
                if (Number.isFinite(len) && len > 20 * 1024 * 1024) {
                    const e: any = new Error("PixVerse 单张图片大小需小于 20MB，请压缩后再试。");
                    e.code = "PIXVERSE_IMAGE_TOO_LARGE";
                    throw e;
                }
            }
        } catch (e: any) {
            // 若是我们主动抛出的超限错误则继续抛出；其它 HEAD 失败不阻断上传（避免某些源站不支持 HEAD）
            if (e?.code === "PIXVERSE_IMAGE_TOO_LARGE") throw e;
        }

        // 根据文档：上传接口要求 multipart/form-data，且支持 image_url 字段
        // 参考：https://docs.platform.pai.video/300925712e0
        const form = new FormData();
        form.append("image_url", imageUrl);

        logPixverseHttp("request", {
            api: "image/upload",
            method: "POST",
            url,
            traceId: realTraceId,
            headers: { "API-KEY": "***", "Ai-trace-id": realTraceId, "Ai-Trace-Id": realTraceId, "Content-Type": "multipart/form-data" },
            body: { image_url: imageUrl },
        });

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "API-KEY": this.getApiKey(),
                "Ai-trace-id": realTraceId,
                "Ai-Trace-Id": realTraceId,
            },
            body: form,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            logPixverseHttp("response", {
                api: "image/upload",
                method: "POST",
                url,
                traceId: realTraceId,
                httpStatus: res.status,
                bodyText: text?.slice?.(0, 500),
            });
            const e: any = new Error(`PixVerse upload failed (HTTP ${res.status})`);
            e.code = "PIXVERSE_UPLOAD_FAILED";
            e.status = res.status;
            e.raw = text;
            throw e;
        }

        const data: any = await res.json().catch(() => null);
        logPixverseHttp("response", {
            api: "image/upload",
            method: "POST",
            url,
            traceId: realTraceId,
            httpStatus: res.status,
            errCode: data?.ErrCode ?? data?.errCode,
            errMsg: data?.ErrMsg ?? data?.errMsg,
            resp: data?.Resp ?? null,
        });
        const errCode = data?.ErrCode ?? data?.errCode;
        const errMsg = data?.ErrMsg ?? data?.errMsg;
        if (typeof errCode === "number" && errCode !== 0) {
            const msg = typeof errMsg === "string" && errMsg ? errMsg : `PixVerse upload failed (ErrCode=${errCode})`;
            const e: any = new Error(msg);
            e.code = "PIXVERSE_UPLOAD_FAILED";
            e.raw = data;
            throw e;
        }

        const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
        const imgIdRaw = resp?.img_id ?? resp?.imgId ?? resp?.imgID ?? resp?.id;
        const imgIdNum = Number(imgIdRaw);
        if (!Number.isFinite(imgIdNum)) {
            const e: any = new Error("PixVerse upload 返回缺少有效的 img_id");
            e.raw = data;
            throw e;
        }

        const imgUrl = resp?.img_url ?? resp?.imgUrl ?? null;
        return { img_id: imgIdNum, img_url: typeof imgUrl === "string" ? imgUrl : null };
    }

    async createImageGenerateFromUrl(input: {
        imageUrl: string;
        prompt: string;
        aspect_ratio: string;
        duration: number;
        model?: string;
        quality: PixverseVideoQuality | string;
        generate_audio_switch?: boolean;
    }): Promise<PixverseCreateTextGenerateResult> {
        // 1) 上传图片拿 img_id
        const traceId = uuidv4();
        const upload = await this.uploadImageToGetImgId(input.imageUrl, traceId);

        // 2) 发起图生视频任务
        const url = `${getBaseUrl()}/openapi/v2/video/img/generate`;
        const payload: Record<string, any> = {
            img_id: upload.img_id,
            aspect_ratio: input.aspect_ratio,
            duration: input.duration,
            model: input.model || this.getDefaultModel(),
            prompt: input.prompt,
            quality: input.quality,
            generate_audio_switch: input.generate_audio_switch ?? true,
        };

        try {
            logPixverseHttp("request", {
                api: "video/img/generate",
                method: "POST",
                url,
                traceId,
                headers: maskPixverseHeaders(this.buildHeaders(traceId)),
                body: { ...payload, prompt: payload.prompt ? `${String(payload.prompt).slice(0, 80)}...` : "" },
            });
            const res = await axiosClient.post(url, payload, {
                headers: this.buildHeaders(traceId),
                timeout: 120000,
            });
            const data = res.data;
            logPixverseHttp("response", {
                api: "video/img/generate",
                method: "POST",
                url,
                traceId,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });
            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                const msg = typeof errMsg === "string" && errMsg ? errMsg : `PixVerse image generate failed (ErrCode=${errCode})`;
                const e: any = new Error(msg);
                e.code = "PIXVERSE_IMAGE_GENERATE_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const videoIdRaw = resp?.video_id ?? resp?.videoId ?? resp?.video_id ?? resp?.id;
            const credits = resp?.credits ?? null;

            const videoIdNum = Number(videoIdRaw);
            if (!Number.isFinite(videoIdNum)) {
                const e: any = new Error("PixVerse image generate 返回缺少有效的 video_id");
                e.raw = data;
                throw e;
            }

            return { video_id: videoIdNum, credits };
        } catch (error: any) {
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async createImageGenerateFromUrls(input: {
        imageUrls: string[];
        prompt: string;
        aspect_ratio: string;
        duration: number;
        model?: string;
        quality: PixverseVideoQuality | string;
        generate_audio_switch?: boolean;
    }): Promise<PixverseCreateTextGenerateResult> {
        const urls = Array.isArray(input.imageUrls) ? input.imageUrls.filter((u) => typeof u === "string" && u.trim()) : [];
        if (urls.length < 1) {
            const e: any = new Error("imageUrls 至少需要 1 张图片");
            e.code = "PIXVERSE_INVALID_IMAGE_URLS";
            throw e;
        }
        if (urls.length > 7) {
            const e: any = new Error("PixVerse 最多支持 7 张图片");
            e.code = "PIXVERSE_TOO_MANY_IMAGES";
            throw e;
        }

        // 文档：/openapi/v2/video/img/generate 必填 img_id；img_ids 仅「多图模版」场景配合 template_id 等使用。
        // 无模版时传 img_ids 会报错（见 ErrMsg: use img_id instead）。
        //
        // 因此这里即使传入多张 URL，也仅使用第一张作为首帧参考图。
        const primaryUrl = urls[0]!.trim();

        // 1) 上传图片拿 img_id（可能触发 20MB 预检）
        const traceId = uuidv4();
        const upload = await this.uploadImageToGetImgId(primaryUrl, traceId);

        // 2) 发起图生视频任务：仅 img_id
        const url = `${getBaseUrl()}/openapi/v2/video/img/generate`;
        const payload: Record<string, any> = {
            aspect_ratio: input.aspect_ratio,
            duration: input.duration,
            model: input.model || this.getDefaultModel(),
            prompt: input.prompt,
            quality: input.quality,
            generate_audio_switch: input.generate_audio_switch ?? true,
            img_id: upload.img_id,
        };

        try {
            logPixverseHttp("request", {
                api: "video/img/generate",
                method: "POST",
                url,
                traceId,
                headers: maskPixverseHeaders(this.buildHeaders(traceId)),
                body: {
                    ...payload,
                    prompt: payload.prompt ? `${String(payload.prompt).slice(0, 80)}...` : "",
                },
            });
            const res = await axiosClient.post(url, payload, {
                headers: this.buildHeaders(traceId),
                timeout: 120000,
            });
            const data = res.data;
            logPixverseHttp("response", {
                api: "video/img/generate",
                method: "POST",
                url,
                traceId,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });

            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                const msg =
                    typeof errMsg === "string" && errMsg
                        ? errMsg
                        : `PixVerse image generate failed (ErrCode=${errCode})`;
                const e: any = new Error(msg);
                e.code = "PIXVERSE_IMAGE_GENERATE_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const videoIdRaw = resp?.video_id ?? resp?.videoId ?? resp?.video_id ?? resp?.id;
            const credits = resp?.credits ?? null;

            const videoIdNum = Number(videoIdRaw);
            if (!Number.isFinite(videoIdNum)) {
                const e: any = new Error("PixVerse image generate 返回缺少有效的 video_id");
                e.raw = data;
                throw e;
            }

            return { video_id: videoIdNum, credits };
        } catch (error: any) {
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async createFusionGenerateFromUrls(
        input: PixverseCreateFusionGenerateFromUrlsInput
    ): Promise<PixverseCreateTextGenerateResult> {
        const urls = Array.isArray(input.imageUrls) ? input.imageUrls.filter((u) => typeof u === "string" && u.trim()) : [];
        if (urls.length < 2) {
            const e: any = new Error("fusion 模式至少需要 2 张图片");
            e.code = "PIXVERSE_INVALID_IMAGE_URLS";
            throw e;
        }
        if (urls.length > 7) {
            const e: any = new Error("PixVerse fusion 最多支持 7 张图片");
            e.code = "PIXVERSE_TOO_MANY_IMAGES";
            throw e;
        }

        // fusion 文档模型范围：v4.5/v5/v5.5/v5.6；这里默认兜底 v5.6
        const requestedModel = String(input.model || "").trim();
        const resolvedModel = requestedModel && /^v(4\.5|5|5\.5|5\.6)$/i.test(requestedModel) ? requestedModel : "v5.6";

        const traceId = uuidv4();
        const imgIds: number[] = [];
        for (const u of urls) {
            const up = await this.uploadImageToGetImgId(u, traceId);
            imgIds.push(up.img_id);
        }

        const refUsed = new Set<string>();
        const refNamesIn = Array.isArray(input.refNames) ? input.refNames : [];
        const image_references = imgIds.map((img_id, idx) => {
            const raw =
                refNamesIn.length === urls.length && typeof refNamesIn[idx] === "string"
                    ? refNamesIn[idx]
                    : undefined;
            const ref_name = allocPixverseRefName(raw, idx, refUsed);
            return {
                type: idx === 0 ? "subject" : "background",
                img_id,
                ref_name,
            };
        });

        const basePrompt = String(input.prompt ?? "").trim();
        const refNamesOrdered = image_references.map((r: any) => String(r.ref_name ?? ""));
        const figureNums = Array.isArray(input.figureNumbers) ? input.figureNumbers : null;
        const normalizedBase = normalizeFusionPromptForPixverse(
            basePrompt,
            refNamesOrdered,
            figureNums && figureNums.length === refNamesOrdered.length ? figureNums : undefined
        );
        const hasAnyRef = image_references.some((r: any) => normalizedBase.includes(`@${r.ref_name}`));
        const prompt = hasAnyRef
            ? normalizedBase
            : `${image_references.map((r: any) => `@${r.ref_name}`).join(" ")} ${normalizedBase}`.trim();

        const url = `${getBaseUrl()}/openapi/v2/video/fusion/generate`;
        const payload: Record<string, any> = {
            image_references,
            prompt,
            model: resolvedModel,
            duration: input.duration,
            quality: input.quality,
            aspect_ratio: input.aspect_ratio,
            ...(typeof input.generate_audio_switch === "boolean" ? { generate_audio_switch: input.generate_audio_switch } : {}),
        };

        try {
            logPixverseHttp("request", {
                api: "video/fusion/generate",
                method: "POST",
                url,
                traceId,
                headers: maskPixverseHeaders(this.buildHeaders(traceId)),
                body: {
                    ...payload,
                    prompt: payload.prompt ? `${String(payload.prompt).slice(0, 80)}...` : "",
                },
            });
            const res = await axiosClient.post(url, payload, {
                headers: this.buildHeaders(traceId),
                timeout: 120000,
            });
            const data = res.data;
            logPixverseHttp("response", {
                api: "video/fusion/generate",
                method: "POST",
                url,
                traceId,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });

            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                const msg =
                    typeof errMsg === "string" && errMsg
                        ? errMsg
                        : `PixVerse fusion generate failed (ErrCode=${errCode})`;
                const e: any = new Error(msg);
                e.code = "PIXVERSE_FUSION_GENERATE_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const videoIdRaw = resp?.video_id ?? resp?.videoId ?? resp?.id;
            const credits = resp?.credits ?? null;
            const videoIdNum = Number(videoIdRaw);
            if (!Number.isFinite(videoIdNum)) {
                const e: any = new Error("PixVerse fusion generate 返回缺少有效的 video_id");
                e.raw = data;
                throw e;
            }

            return { video_id: videoIdNum, credits };
        } catch (error: any) {
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async createTransitionGenerateFromUrls(
        input: PixverseCreateTransitionGenerateFromUrlsInput
    ): Promise<PixverseCreateTextGenerateResult> {
        // 转场接口要求 first/last 两张图的 img_id
        const traceId = uuidv4();
        const firstUpload = await this.uploadImageToGetImgId(input.firstImageUrl, traceId);
        const lastUpload = await this.uploadImageToGetImgId(input.lastImageUrl, uuidv4());

        // 统一默认使用 v6；如果调用方显式传 model，则以传入为准。
        const resolvedModel = input.model || this.getDefaultModel();

        const url = `${getBaseUrl()}/openapi/v2/video/transition/generate`;
        const seed = Math.floor(Math.random() * 2147483647);
        const payloadBase: Record<string, any> = {
            first_frame_img: firstUpload.img_id,
            last_frame_img: lastUpload.img_id,

            prompt: input.prompt,
            model: resolvedModel,
            duration: input.duration,
            quality: input.quality,

            motion_mode: "normal",
            seed,
        };

        // 注意：上游实际对字段支持存在“按模型区分”的校验。
        // 实测 v5.6 会拒绝 sound_effect_switch（ErrCode=400017），因此这里按模型最小化 payload。
        const payload: Record<string, any> = {
            ...payloadBase,
            // 文档里写的是 string，但语义是 true/false；这里按 boolean 传（与文生/图生一致）
            generate_audio_switch: input.generate_audio_switch ?? true,
        };

        // 实测：v5.6 / v6 会拒绝 sound_effect_switch（ErrCode=400017）
        const supportsSoundEffectSwitch = !/^v(5\.6|6)$/i.test(resolvedModel);
        if (supportsSoundEffectSwitch) {
            payload.sound_effect_switch = input.generate_audio_switch ?? true;
            payload.sound_effect_content = "";
        }

        // lip_sync 字段在不同模型上也可能受限；默认关闭并仅在“需要时且模型支持时”再扩展
        const supportsLipSync = /^v(3\.5|4(\.5)?|5)$/i.test(resolvedModel);
        if (supportsLipSync) {
            payload.lip_sync_switch = false;
            payload.lip_sync_tts_content = "";
            payload.lip_sync_tts_speaker_id = "";
        }

        try {
            logPixverseHttp("request", {
                api: "video/transition/generate",
                method: "POST",
                url,
                traceId: undefined,
                headers: maskPixverseHeaders(this.buildHeaders("**see Ai-trace-id header**")),
                body: { ...payload, prompt: payload.prompt ? `${String(payload.prompt).slice(0, 80)}...` : "" },
            });
            const res = await axiosClient.post(url, payload, {
                headers: this.buildHeaders(uuidv4()),
                timeout: 120000,
            });

            const data = res.data;
            logPixverseHttp("response", {
                api: "video/transition/generate",
                method: "POST",
                url,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });
            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                const msg =
                    typeof errMsg === "string" && errMsg
                        ? errMsg
                        : `PixVerse transition generate failed (ErrCode=${errCode})`;
                const e: any = new Error(msg);
                e.code = "PIXVERSE_TRANSITION_GENERATE_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const videoIdRaw = resp?.video_id ?? resp?.videoId ?? resp?.id;
            const credits = resp?.credits ?? null;

            const videoIdNum = Number(videoIdRaw);
            if (!Number.isFinite(videoIdNum)) {
                const e: any = new Error("PixVerse transition 返回缺少有效的 video_id");
                e.raw = data;
                throw e;
            }

            return { video_id: videoIdNum, credits };
        } catch (error: any) {
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async getVideoTask(videoId: string | number): Promise<PixverseGetVideoResult> {
        const url = `${getBaseUrl()}/openapi/v2/video/result/${videoId}`;

        const traceId = uuidv4();
        try {
            logPixverseHttp("request", {
                api: "video/result",
                method: "GET",
                url,
                traceId,
                headers: maskPixverseHeaders(this.buildHeaders(traceId)),
            });
            const res = await axiosClient.get(url, {
                headers: this.buildHeaders(traceId),
                timeout: 60000,
            });

            const data = res.data;
            logPixverseHttp("response", {
                api: "video/result",
                method: "GET",
                url,
                traceId,
                httpStatus: res.status,
                errCode: data?.ErrCode ?? data?.errCode,
                errMsg: data?.ErrMsg ?? data?.errMsg,
                resp: data?.Resp ?? null,
            });
            const errCode = data?.ErrCode ?? data?.errCode;
            const errMsg = data?.ErrMsg ?? data?.errMsg;
            if (typeof errCode === "number" && errCode !== 0) {
                // result 接口也可能返回错误码；统一当作失败
                const e: any = new Error(
                    typeof errMsg === "string" && errMsg ? errMsg : `PixVerse result failed (ErrCode=${errCode})`
                );
                e.code = "PIXVERSE_RESULT_FAILED";
                e.raw = data;
                throw e;
            }

            const resp = data?.Resp ?? data?.resp ?? data?.data ?? data;
            const status = Number(resp?.status ?? resp?.Status ?? 0);

            const videoUrlRaw = resp?.url ?? resp?.video_url ?? resp?.videoUrl ?? null;
            const normalizedUrl = normalizePixverseMediaUrl(videoUrlRaw);
            let videoUrl = normalizedUrl;

            // 防御：上游可能在 status=5(生成中) 或 status=1(成功) 时就返回 url，
            // 但 CDN 文件尚未就绪/可访问（或存在 404 负缓存/边缘延迟）。
            // 只要出现 url 且任务不是失败态，就先 probe；可访问才下发给前端/落库。
            if ((status === 1 || status === 5) && typeof videoUrl === "string" && videoUrl) {
                const probe = await probeMediaUrlAccessible(videoUrl, { maxAttempts: 5 });
                if (!probe.ok) {
                    logPixverseHttp("probe", {
                        api: "media/probe",
                        method: "GET",
                        url: videoUrl,
                        ok: probe.ok,
                        status: probe.status,
                        statusRaw: status,
                    });
                    videoUrl = null;
                } else {
                    // 可访问时加一个 cache-bust，尽量避免客户端命中旧的 404 缓存
                    videoUrl = withCacheBust(videoUrl);
                }
            }

            // 任务级错误只取 Resp 内字段；不要把顶层 data.ErrMsg（ErrCode=0 时常为 "Success"）当作任务 errorMessage
            const rawMsg = resp?.errorMessage ?? resp?.error_message ?? null;
            let errorMessage: string | null = typeof rawMsg === "string" ? rawMsg.trim() : null;
            if (errorMessage && /^(success|ok)$/i.test(errorMessage) && (status === 1 || status === 5)) {
                errorMessage = null;
            }

            return {
                status,
                videoUrl,
                errorMessage,
                prompt: typeof resp?.prompt === "string" ? resp.prompt : null,
                negative_prompt: typeof resp?.negative_prompt === "string" ? resp.negative_prompt : null,
                seed: Number.isFinite(Number(resp?.seed)) ? Number(resp?.seed) : null,
                style: typeof resp?.style === "string" ? resp.style : null,
                outputWidth: Number.isFinite(Number(resp?.outputWidth)) ? Number(resp?.outputWidth) : null,
                outputHeight: Number.isFinite(Number(resp?.outputHeight)) ? Number(resp?.outputHeight) : null,
            };
        } catch (error: any) {
            const statusCode = error?.response?.status;
            if (statusCode) {
                (error as any).status = statusCode;
            }
            throw error;
        }
    }

    async probeVideoUrlAccessible(url: string, opts?: { maxAttempts?: number }) {
        return await probeMediaUrlAccessible(url, opts);
    }
}

