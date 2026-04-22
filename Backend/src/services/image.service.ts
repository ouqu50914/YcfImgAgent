import { AppDataSource } from "../data-source";
import { ImageResult } from "../entities/ImageResult";
import { ApiConfig } from "../entities/ApiConfig";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { DreamAdapter } from "../adapters/dream.adapter";
import { NanoAdapter } from "../adapters/nano.adapter";
import { AnyfastNanoAdapter } from "../adapters/anyfast-nano.adapter";
import { MidjourneyAdapter } from "../adapters/midjourney.adapter";
import { GenerateParams, UpscaleParams, ExtendParams, SplitParams } from "../adapters/ai-provider.interface";
import { CreditService, type CreditLogInfo } from "./credit.service";
import { ProviderError } from "../adapters/provider-error";
import { calculateNanoPolicyRates, isFallbackEligible } from "./nano-policy.util";
import { detectImageFormat } from "../utils/image-format";
import { isCosEnabled, upload as cosUpload, pathToKey } from "./cos.service";

const axiosClient = axios.create({ proxy: false });

export class ImageService {
    private imageRepo = AppDataSource.getRepository(ImageResult);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private creditService = new CreditService();

    private static anyfastConsecutiveFailures = 0;
    private static anyfastCircuitOpenUntil = 0;
    private static nanoPolicyMetrics = {
        totalRequests: 0,
        switchedToAnyfast: 0,
        finalAnyfast: 0,
    };
    private static nanoPolicyRequestSeq = 0;
    private static imageSyncInFlight = new Set<number>();

    private readonly nanoPrimaryProvider = (process.env.NANO_PRIMARY_PROVIDER || "anyfast") as "ace" | "anyfast";
    private readonly nanoFallbackProvider = (process.env.NANO_FALLBACK_PROVIDER || "ace") as "ace" | "anyfast";
    private readonly nanoAceMaxAttemptsPerRequest = Math.max(1, Number(process.env.NANO_ACE_MAX_ATTEMPTS_PER_REQUEST || "1"));
    private readonly nanoFallbackOnTransientOnly = process.env.NANO_FALLBACK_ON_TRANSIENT_ONLY === "true";
    private readonly anyfastCircuitFailureThreshold = Math.max(1, Number(process.env.NANO_ANYFAST_CIRCUIT_FAILURE_THRESHOLD || "3"));
    private readonly anyfastCircuitOpenMs = Math.max(1000, Number(process.env.NANO_ANYFAST_CIRCUIT_OPEN_MS || "60000"));

    private adapters = {
        'dream': new DreamAdapter(),
        'nano': new NanoAdapter(),
        'midjourney': new MidjourneyAdapter(),
    };
    private nanoProviderAdapters = {
        ace: new NanoAdapter(),
        anyfast: new AnyfastNanoAdapter(),
    };

    /**
     * 扣减积分并在失败时回滚，记录使用日志
     */
    private async deductAndExecute<T>(
        userId: number,
        cost: number,
        fn: () => Promise<T>,
        logInfo?: CreditLogInfo
    ): Promise<T> {
        await this.creditService.deductCredits(userId, cost, logInfo);
        try {
            return await fn();
        } catch (error) {
            await this.creditService.addCredits(userId, cost);
            throw error;
        }
    }

    private parseJsonImageArray(raw?: string | null): string[] {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((x) => typeof x === "string" && x.trim().length > 0);
        } catch {
            return [];
        }
    }

    private toPersistableImageUrl(url?: string): string | undefined {
        if (!url) return undefined;
        // image_url 列是 varchar(255)，data URL（base64）会超长导致写库失败
        if (url.startsWith("data:")) return undefined;
        if (url.length > 255) return undefined;
        return url;
    }

    private summarizeImageRef(url?: string): string | undefined {
        if (!url) return undefined;
        if (url.startsWith("data:")) {
            const prefix = url.slice(0, 48);
            return `${prefix}... [data-url ${url.length} chars]`;
        }
        if (url.length > 180) return `${url.slice(0, 180)}...`;
        return url;
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === "string") return error;
        if (error && typeof error === "object") {
            const e = error as any;
            const candidate =
                e?.message ||
                e?.error?.message ||
                e?.response?.data?.message ||
                e?.response?.data?.error?.message ||
                e?.msg;
            if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
            try {
                return JSON.stringify(error);
            } catch {
                return String(error);
            }
        }
        return String(error);
    }

    private toDataUrlBuffer(imageInput: string): { mimeType: string; buffer: Buffer } | null {
        const m = imageInput.match(/^data:([^;]+);base64,(.+)$/);
        if (!m || !m[1] || !m[2]) return null;
        return {
            mimeType: m[1],
            buffer: Buffer.from(m[2], "base64"),
        };
    }

    private async storeImageBuffer(buffer: Buffer, preferredMime?: string): Promise<string> {
        const detected = detectImageFormat({ firstBytes: buffer.subarray(0, 32) });
        const mime = preferredMime || detected.mime;
        const ext = detected.ext || ".png";
        const fileName = `imgsync_${uuidv4()}${ext}`;
        const storagePath = `/uploads/${fileName}`;
        if (isCosEnabled()) {
            await cosUpload(pathToKey(storagePath), buffer, mime);
            return storagePath;
        }
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return storagePath;
    }

    private async syncOneImageToStorage(imageInput: string): Promise<string> {
        if (!imageInput) throw new Error("空图片地址");
        if (imageInput.startsWith("/uploads/")) return imageInput;

        const dataUrl = this.toDataUrlBuffer(imageInput);
        if (dataUrl) {
            return this.storeImageBuffer(dataUrl.buffer, dataUrl.mimeType);
        }

        if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            const res = await axiosClient.get(imageInput, {
                responseType: "arraybuffer",
                timeout: 120000,
            });
            const contentType = typeof res.headers?.["content-type"] === "string"
                ? res.headers["content-type"]
                : undefined;
            return this.storeImageBuffer(Buffer.from(res.data), contentType);
        }

        // 兜底：未知格式不改写，避免丢失可用结果
        return imageInput;
    }

    private startAsyncImageSync(recordId: number) {
        if (ImageService.imageSyncInFlight.has(recordId)) return;
        ImageService.imageSyncInFlight.add(recordId);

        void (async () => {
            try {
                const rec = await this.imageRepo.findOneBy({ id: recordId } as any);
                if (!rec) return;
                const sourceImages = this.parseJsonImageArray(rec.upstream_images || rec.all_images);
                if (!sourceImages.length) {
                    rec.sync_status = "failed";
                    rec.sync_error = "无可同步图片";
                    await this.imageRepo.save(rec);
                    return;
                }

                rec.sync_status = "syncing";
                rec.sync_error = null;
                await this.imageRepo.save(rec);

                const syncedImages = await Promise.all(sourceImages.map((u) => this.syncOneImageToStorage(u)));
                rec.all_images = JSON.stringify(syncedImages);
                const persistableSyncedFirst = this.toPersistableImageUrl(syncedImages[0]);
                if (persistableSyncedFirst !== undefined) {
                    rec.image_url = persistableSyncedFirst;
                }
                rec.sync_status = "synced";
                rec.sync_error = null;
                await this.imageRepo.save(rec);
            } catch (error) {
                const rec = await this.imageRepo.findOneBy({ id: recordId } as any);
                if (rec) {
                    rec.sync_status = "failed";
                    rec.sync_error = error instanceof Error ? error.message : String(error);
                    await this.imageRepo.save(rec);
                }
            } finally {
                ImageService.imageSyncInFlight.delete(recordId);
            }
        })();
    }

    async generate(userId: number, apiType: 'dream' | 'nano' | 'midjourney', params: GenerateParams) {
        // 1. 获取API配置
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        // 2. 计算需要生成的图片数量
        const imageCount = params.num_images || (params as any).numImages || 1;
        const quality = params.quality || (params as any).quality || '2K';
        const cost = this.creditService.calcCost(apiType, 'generate', {
            quality,
            imageCount,
            ...(params.model ? { model: params.model } : {}),
            ...(params.providerHint ? { providerHint: params.providerHint } : {}),
        });

        const generationKey = params.generationKey;

        const result = await this.deductAndExecute(userId, cost, async () => {
            // 1) 先创建“占位结果记录”，以便刷新/历史恢复后能用 generation_key 查询到最终态
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;
            // generation_key 字段在实体里是 string（nullable=true），这里避免把 null 赋给 string 类型。
            imageRecord.generation_key = generationKey ?? '';
            // 0 = pending（未完成）
            imageRecord.status = 0;
            imageRecord.sync_status = "pending";
            imageRecord.sync_error = null;
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "generate";
            await this.imageRepo.save(imageRecord);

            try {
                // 2) 调用适配器生成图片（nano 走 Ace 优先 + AnyFast 回退策略）
                const providerResult = await this.generateByPolicy(apiType, params, config.api_key, config.api_url, userId);
                const apiResult = providerResult.apiResult;

                // 3) 保存结果到数据库（已在适配器中完成转存，直接返回可访问短路径）
                const allImageUrls = apiResult.images || [];
                const actualGeneratedCount = allImageUrls.length;

                const firstImageUrl = allImageUrls[0];
                const persistableFirstUrl = this.toPersistableImageUrl(firstImageUrl);
                if (persistableFirstUrl !== undefined) {
                    imageRecord.image_url = persistableFirstUrl;
                }

                imageRecord.status = 1;
                imageRecord.all_images = JSON.stringify(allImageUrls);
                imageRecord.upstream_images = null;
                imageRecord.sync_status = "synced";
                imageRecord.sync_error = null;
                await this.imageRepo.save(imageRecord);

                config.used_quota += actualGeneratedCount;
                await this.configRepo.save(config);

                return {
                    ...imageRecord,
                    all_images: allImageUrls,
                    provider_policy: providerResult.policyTrace,
                } as any;
            } catch (error) {
                // 生成失败：标记失败态（status=2），避免前端靠等待时间“猜测”失败。
                imageRecord.status = 2;
                imageRecord.all_images = imageRecord.all_images ?? null;
                imageRecord.sync_status = "failed";
                imageRecord.sync_error = error instanceof Error ? error.message : String(error);
                await this.imageRepo.save(imageRecord);
                throw error;
            }
        }, { operationType: 'generate', apiType });

        return result;
    }

    private isAnyfastCircuitOpen(): boolean {
        return Date.now() < ImageService.anyfastCircuitOpenUntil;
    }

    private markAnyfastFailure() {
        ImageService.anyfastConsecutiveFailures += 1;
        if (ImageService.anyfastConsecutiveFailures >= this.anyfastCircuitFailureThreshold) {
            ImageService.anyfastCircuitOpenUntil = Date.now() + this.anyfastCircuitOpenMs;
        }
    }

    private markAnyfastSuccess() {
        ImageService.anyfastConsecutiveFailures = 0;
        ImageService.anyfastCircuitOpenUntil = 0;
    }

    private recordNanoPolicyMetric(finalProvider: "ace" | "anyfast", switched: boolean) {
        ImageService.nanoPolicyMetrics.totalRequests += 1;
        if (switched) ImageService.nanoPolicyMetrics.switchedToAnyfast += 1;
        if (finalProvider === "anyfast") ImageService.nanoPolicyMetrics.finalAnyfast += 1;
    }

    private shouldFallback(error: unknown): boolean {
        return isFallbackEligible(error, this.nanoFallbackOnTransientOnly);
    }

    /**
     * AnyFast 模型在回退到 Ace 时需要映射到 Ace 可识别的模型名。
     * - gemini-3-pro-image-preview -> nano-banana-2
     * - gemini-3.1-flash-image-preview -> nano-banana-pro
     */
    private mapModelForProvider(provider: "ace" | "anyfast", model?: GenerateParams["model"]): GenerateParams["model"] {
        if (provider !== "ace" || !model) return model;
        if (model === "gemini-3-pro-image-preview") return "nano-banana-2";
        if (model === "gemini-3.1-flash-image-preview") return "nano-banana-pro";
        return model;
    }

    private async generateByPolicy(
        apiType: "dream" | "nano" | "midjourney",
        params: GenerateParams,
        apiKey: string,
        apiUrl: string,
        userId?: number
    ): Promise<{ apiResult: { images?: string[]; original_id: string }; policyTrace: Record<string, unknown> }> {
        if (apiType !== "nano") {
            const adapter = this.adapters[apiType];
            if (!adapter) throw new Error("未知的API类型");
            const apiResult = await adapter.generateImage(params, apiKey, apiUrl);
            return {
                apiResult,
                policyTrace: {
                    provider_chain: [apiType],
                    final_provider: apiType,
                    attempt_count: 1,
                },
            };
        }

        const providerChain: string[] = [];
        let switchReason = "";
        const startedAt = Date.now();
        const requestId = params.generationKey || `nano-${Date.now()}`;
        const requestSeq = ++ImageService.nanoPolicyRequestSeq;
        const normalizedUserId = Number(userId);
        const hasValidUserId = Number.isFinite(normalizedUserId) && normalizedUserId > 0;
        const isAdmin = hasValidUserId ? await this.creditService.isAdmin(normalizedUserId) : false;
        const isAnyfastProRequest = params.model === "gemini-3-pro-image-preview";
        if (!isAdmin && isAnyfastProRequest) {
            const deniedError = Object.assign(new Error("普通用户暂不支持使用 AnyFast Nano Pro"), {
                status: 403,
                code: "ANYFAST_PRO_FORBIDDEN",
            });
            console.warn("[ImageService][NanoPolicyRequest] blocked_forbidden_model", {
                request_seq: requestSeq,
                request_id: requestId,
                user_id: hasValidUserId ? normalizedUserId : undefined,
                is_admin: isAdmin,
                provider_hint: params.providerHint,
                model: params.model,
                reason: "non_admin_forbidden_anyfast_pro",
            });
            throw deniedError;
        }
        const requestedAnyfastDirect =
            params.providerHint === "anyfast" ||
            params.model === "gemini-3.1-flash-image-preview" ||
            params.model === "gemini-3-pro-image-preview";
        const requestedAceDirect = params.providerHint === "ace";

        // 路由策略（普通用户/管理员统一）：
        // - 用户显式选了 ace/anyfast：按所选为主路由，另一家为兜底
        // - 未显式选择：沿用系统默认主路由，并固定另一家为兜底
        const primary: "ace" | "anyfast" = requestedAceDirect
            ? "ace"
            : requestedAnyfastDirect
                ? "anyfast"
                : this.nanoPrimaryProvider;
        const fallback: "ace" | "anyfast" = primary === "ace" ? "anyfast" : "ace";
        const refCount =
            (params.imageUrls && params.imageUrls.length > 0)
                ? params.imageUrls.length
                : params.imageUrl
                    ? 1
                    : 0;

        console.log("[ImageService][NanoPolicyRequest] start", {
            request_seq: requestSeq,
            request_id: requestId,
            user_id: hasValidUserId ? normalizedUserId : undefined,
            is_admin: isAdmin,
            primary_provider: primary,
            fallback_provider: fallback,
            direct_anyfast: requestedAnyfastDirect,
            direct_ace: requestedAceDirect,
            prompt: params.prompt,
            model: params.model,
            quality: params.quality,
            aspect_ratio: params.aspectRatio,
            num_images: params.num_images || (params as any).numImages || 1,
            reference_image_count: refCount,
        });

        const tryProvider = async (provider: "ace" | "anyfast", attempt: number) => {
            providerChain.push(provider);
            const mappedModel = this.mapModelForProvider(provider, params.model);
            const providerParams: GenerateParams = {
                ...params,
                providerHint: provider,
                ...(mappedModel ? { model: mappedModel } : {}),
            };
            console.log("[ImageService][NanoPolicyRequest] attempt_start", {
                request_seq: requestSeq,
                request_id: requestId,
                attempt,
                provider,
                provider_chain: providerChain.join("->"),
                input_model: params.model,
                mapped_model: mappedModel,
            });
            const adapter = this.nanoProviderAdapters[provider];
            const result = await adapter.generateImage(providerParams, apiKey, apiUrl);
            console.log("[ImageService][NanoPolicyRequest] attempt_success", {
                request_seq: requestSeq,
                request_id: requestId,
                attempt,
                provider,
                mapped_model: mappedModel,
                image_count: result.images?.length || 0,
                first_image: this.summarizeImageRef(result.images?.[0]),
                original_id: result.original_id,
            });
            return { result, attempt, provider };
        };

        try {
            if (primary === "ace") {
                let lastError: unknown;
                for (let i = 1; i <= this.nanoAceMaxAttemptsPerRequest; i++) {
                    try {
                        const ok = await tryProvider("ace", i);
                        console.log("[ImageService][NanoPolicyRequest] completed", {
                            request_seq: requestSeq,
                            request_id: requestId,
                            final_provider: "ace",
                            provider_chain: providerChain.join("->"),
                            attempt_count: providerChain.length,
                            switch_reason: switchReason || undefined,
                            latency_ms: Date.now() - startedAt,
                            image_count: ok.result.images?.length || 0,
                            first_image: this.summarizeImageRef(ok.result.images?.[0]),
                            original_id: ok.result.original_id,
                        });
                        return {
                            apiResult: ok.result,
                            policyTrace: {
                                request_seq: requestSeq,
                                request_id: requestId,
                                provider_chain: providerChain.join("->"),
                                final_provider: "ace",
                                attempt_count: providerChain.length,
                                latency_ms: Date.now() - startedAt,
                            },
                        };
                    } catch (error) {
                        lastError = error;
                        console.warn("[ImageService][NanoPolicyRequest] attempt_failed", {
                            request_seq: requestSeq,
                            request_id: requestId,
                            attempt: i,
                            provider: "ace",
                            message: this.getErrorMessage(error),
                        });
                        const canRetryAce = this.shouldFallback(error) && i < this.nanoAceMaxAttemptsPerRequest;
                        if (!canRetryAce) break;
                    }
                }

                const canFallbackToAnyfast = isAdmin;
                const canFallback = canFallbackToAnyfast
                    && this.shouldFallback(lastError)
                    && fallback === "anyfast"
                    && !this.isAnyfastCircuitOpen();
                if (!canFallback) throw lastError;
                switchReason = lastError instanceof ProviderError ? lastError.code : "ACE_FAILED";
                try {
                    const fallbackOk = await tryProvider("anyfast", providerChain.length + 1);
                    this.markAnyfastSuccess();
                    console.log("[ImageService][NanoPolicyRequest] completed", {
                        request_seq: requestSeq,
                        request_id: requestId,
                        final_provider: "anyfast",
                        provider_chain: providerChain.join("->"),
                        attempt_count: providerChain.length,
                        switch_reason: switchReason || undefined,
                        latency_ms: Date.now() - startedAt,
                        image_count: fallbackOk.result.images?.length || 0,
                        first_image: this.summarizeImageRef(fallbackOk.result.images?.[0]),
                        original_id: fallbackOk.result.original_id,
                    });
                    return {
                        apiResult: fallbackOk.result,
                        policyTrace: {
                            request_seq: requestSeq,
                            request_id: requestId,
                            provider_chain: providerChain.join("->"),
                            final_provider: "anyfast",
                            attempt_count: providerChain.length,
                            switch_reason: switchReason,
                            latency_ms: Date.now() - startedAt,
                        },
                    };
                } catch (fallbackError) {
                    this.markAnyfastFailure();
                    console.warn("[ImageService][NanoPolicyRequest] attempt_failed", {
                        request_seq: requestSeq,
                        request_id: requestId,
                        attempt: providerChain.length,
                        provider: "anyfast",
                        message: this.getErrorMessage(fallbackError),
                    });
                    throw fallbackError;
                }
            }

            // 兼容 future: anyfast 作为主，ace 作为备
            try {
                const first = await tryProvider(primary, 1);
                this.markAnyfastSuccess();
                console.log("[ImageService][NanoPolicyRequest] completed", {
                    request_seq: requestSeq,
                    request_id: requestId,
                    final_provider: primary,
                    provider_chain: providerChain.join("->"),
                    attempt_count: providerChain.length,
                    switch_reason: switchReason || undefined,
                    latency_ms: Date.now() - startedAt,
                    image_count: first.result.images?.length || 0,
                    first_image: this.summarizeImageRef(first.result.images?.[0]),
                    original_id: first.result.original_id,
                });
                return {
                    apiResult: first.result,
                    policyTrace: {
                        request_seq: requestSeq,
                        request_id: requestId,
                        provider_chain: providerChain.join("->"),
                        final_provider: primary,
                        attempt_count: providerChain.length,
                        latency_ms: Date.now() - startedAt,
                    },
                };
            } catch (primaryError) {
                this.markAnyfastFailure();
                console.warn("[ImageService][NanoPolicyRequest] attempt_failed", {
                    request_seq: requestSeq,
                    request_id: requestId,
                    attempt: 1,
                    provider: primary,
                    message: this.getErrorMessage(primaryError),
                });
                if (!this.shouldFallback(primaryError) || fallback === primary) throw primaryError;
                switchReason = primaryError instanceof ProviderError ? primaryError.code : "PRIMARY_FAILED";
                const second = await tryProvider(fallback, 2);
                console.log("[ImageService][NanoPolicyRequest] completed", {
                    request_seq: requestSeq,
                    request_id: requestId,
                    final_provider: fallback,
                    provider_chain: providerChain.join("->"),
                    attempt_count: providerChain.length,
                    switch_reason: switchReason || undefined,
                    latency_ms: Date.now() - startedAt,
                    image_count: second.result.images?.length || 0,
                    first_image: this.summarizeImageRef(second.result.images?.[0]),
                    original_id: second.result.original_id,
                });
                return {
                    apiResult: second.result,
                    policyTrace: {
                        request_seq: requestSeq,
                        request_id: requestId,
                        provider_chain: providerChain.join("->"),
                        final_provider: fallback,
                        attempt_count: providerChain.length,
                        switch_reason: switchReason,
                        latency_ms: Date.now() - startedAt,
                    },
                };
            }
        } catch (error) {
            const msg = this.getErrorMessage(error) || "未知错误";
            console.error("[ImageService][NanoPolicyRequest] failed", {
                request_seq: requestSeq,
                request_id: requestId,
                provider_chain: providerChain.join("->") || "none",
                attempt_count: providerChain.length,
                switch_reason: switchReason || undefined,
                latency_ms: Date.now() - startedAt,
                message: msg,
            });
            throw new Error(`Nano 生成失败，供应商链路 ${providerChain.join("->") || "none"}: ${msg}`);
        } finally {
            const finalProvider = providerChain[providerChain.length - 1];
            if (finalProvider === "ace" || finalProvider === "anyfast") {
                const switched = providerChain.length > 1 && providerChain.includes("anyfast");
                this.recordNanoPolicyMetric(finalProvider, switched);
                const m = ImageService.nanoPolicyMetrics;
                const rates = calculateNanoPolicyRates(m);
                console.log("[ImageService][NanoPolicy]", {
                    total_requests: m.totalRequests,
                    switch_to_anyfast_rate: rates.switchToAnyfastRate,
                    anyfast_final_rate: rates.anyfastFinalRate,
                    anyfast_circuit_open: this.isAnyfastCircuitOpen(),
                });
            }
        }
    }

    /**
     * 按 generation_key 查询生成结果（用于刷新/历史恢复后拉取最终态）
     */
    async getGenerateResultByGenerationKey(
        userId: number,
        generationKey: string
    ): Promise<{
        id: number;
        status: number;
        image_url?: string;
        all_images: string[];
        created_at?: Date;
        sync_status?: string;
    } | null> {
        if (!generationKey) return null;

        const rec = await this.imageRepo.findOneBy({
            user_id: userId,
            generation_key: generationKey,
        } as any);

        if (!rec) return null;

        let allImages: string[] = [];
        if (rec.all_images) {
            try {
                const parsed = JSON.parse(rec.all_images);
                if (Array.isArray(parsed)) {
                    allImages = parsed.filter((x) => typeof x === 'string' && x.trim().length > 0);
                }
            } catch {
                // ignore parse error
            }
        }

        // exactOptionalPropertyTypes=true 下：可选字段不能显式传 undefined
        const out: {
            id: number;
            status: number;
            image_url?: string;
            all_images: string[];
            created_at?: Date;
            sync_status?: string;
        } = {
            id: Number(rec.id),
            status: rec.status,
            all_images: allImages,
            created_at: rec.created_at,
            sync_status: rec.sync_status || "pending",
        };

        if (typeof rec.image_url === 'string') {
            out.image_url = rec.image_url;
        }

        return out;
    }

    /**
     * 图片放大
     */
    async upscale(userId: number, apiType: 'dream' | 'nano', params: UpscaleParams, enableFallback: boolean = true): Promise<ImageResult> {
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}未启用，自动降级到${fallbackType}`);
                return this.upscale(userId, fallbackType, params, false);
            }
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        const cost = this.creditService.calcCost(apiType, 'upscale');

        const adapter = this.adapters[apiType];
        if (!adapter || typeof adapter.upscaleImage !== 'function') {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackAdapter = this.adapters[fallbackType];
                if (fallbackAdapter && typeof fallbackAdapter.upscaleImage === 'function') {
                    console.log(`[ImageService] ${apiType}不支持放大，自动降级到${fallbackType}`);
                    return this.upscale(userId, fallbackType, params, false);
                }
            }
            throw new Error(`API [${apiType}] 不支持图片放大功能`);
        }

        const result = await this.deductAndExecute(userId, cost, async () => {
            const apiResult = await adapter.upscaleImage(params, config.api_key, config.api_url);

            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = `放大图片 ${params.scale || 2}x`;
            const firstImageUrl = this.toPersistableImageUrl(apiResult.images?.[0]);
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "upscale";
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        }, { operationType: 'upscale', apiType });

        return result;
    }

    /**
     * 图片扩展
     */
    async extend(userId: number, apiType: 'dream' | 'nano', params: ExtendParams, enableFallback: boolean = true): Promise<ImageResult> {
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}未启用，自动降级到${fallbackType}`);
                return this.extend(userId, fallbackType, params, false);
            }
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        const cost = this.creditService.calcCost(apiType, 'extend');

        const adapter = this.adapters[apiType];
        if (!adapter || typeof adapter.extendImage !== 'function') {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackAdapter = this.adapters[fallbackType];
                if (fallbackAdapter && typeof fallbackAdapter.extendImage === 'function') {
                    console.log(`[ImageService] ${apiType}不支持扩展，自动降级到${fallbackType}`);
                    return this.extend(userId, fallbackType, params, false);
                }
            }
            throw new Error(`API [${apiType}] 不支持图片扩展功能`);
        }

        const result = await this.deductAndExecute(userId, cost, async () => {
            const apiResult = await adapter.extendImage(params, config.api_key, config.api_url);

            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = `扩展图片 ${params.direction}`;
            const firstImageUrl = this.toPersistableImageUrl(apiResult.images?.[0]);
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "extend";
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        }, { operationType: 'extend', apiType });

        return result;
    }

    /**
     * 图片拆分
     */
    async split(userId: number, apiType: 'dream' | 'nano', params: SplitParams, enableFallback: boolean = true): Promise<ImageResult> {
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}未启用，自动降级到${fallbackType}`);
                return this.split(userId, fallbackType, params, false);
            }
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        const cost = this.creditService.calcCost(apiType, 'split');

        const adapter = this.adapters[apiType];
        if (!adapter || typeof adapter.splitImage !== 'function') {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackAdapter = this.adapters[fallbackType];
                if (fallbackAdapter && typeof fallbackAdapter.splitImage === 'function') {
                    console.log(`[ImageService] ${apiType}不支持拆分，自动降级到${fallbackType}`);
                    return this.split(userId, fallbackType, params, false);
                }
            }
            throw new Error(`API [${apiType}] 不支持图片拆分功能`);
        }

        const result = await this.deductAndExecute(userId, cost, async () => {
            const apiResult = await adapter.splitImage(params, config.api_key, config.api_url);

            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = `拆分图片 ${params.splitDirection || 'horizontal'} ${params.splitCount || 2} 份`;
            const firstImageUrl = this.toPersistableImageUrl(apiResult.images?.[0]);
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "split";
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        }, { operationType: 'split', apiType });

        return result;
    }

    /**
     * 生图功能也支持自动降级
     */
    async generateWithFallback(userId: number, apiType: 'dream' | 'nano' | 'midjourney', params: GenerateParams, enableFallback: boolean = true): Promise<ImageResult> {
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}未启用，自动降级到${fallbackType}`);
                return this.generateWithFallback(userId, fallbackType, params, false);
            }
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        const adapter = this.adapters[apiType];
        if (!adapter) {
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}适配器不存在，自动降级到${fallbackType}`);
                return this.generateWithFallback(userId, fallbackType, params, false);
            }
            throw new Error("未知的API类型");
        }

        const imageCount = params.num_images || (params as any).numImages || 1;
        const quality = params.quality || (params as any).quality || '2K';
        const cost = this.creditService.calcCost(apiType, 'generate', { quality, imageCount });

        const result = await this.deductAndExecute(userId, cost, async () => {
            const apiResult = await adapter.generateImage(params, config.api_key, config.api_url);

            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;
            const firstImageUrl = this.toPersistableImageUrl(apiResult.images?.[0]);
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "generate";
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        }, { operationType: 'generate', apiType });

        return result;
    }

    /**
     * 当前用户的图片生成记录列表（画布「项目产物」等）
     */
    async listResults(
        userId: number,
        opts?: {
            templateId?: number;
            from?: string;
            to?: string;
            status?: number;
            page?: number;
            pageSize?: number;
        }
    ) {
        const page = Math.max(1, opts?.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 30));

        if (opts?.templateId != null && opts.templateId > 0) {
            const t = await this.templateRepo.findOne({
                where: { id: opts.templateId },
                select: ["id", "user_id"],
            });
            if (!t || Number(t.user_id) !== Number(userId)) {
                throw Object.assign(new Error("无权查看该项目下的图片记录"), { status: 403 });
            }
        }

        const qb = this.imageRepo
            .createQueryBuilder("ir")
            .where("ir.user_id = :uid", { uid: userId })
            .orderBy("ir.created_at", "DESC");

        if (opts?.templateId != null && opts.templateId > 0) {
            qb.andWhere("ir.template_id = :tid", { tid: opts.templateId });
        }
        if (opts?.from) {
            qb.andWhere("ir.created_at >= :from", { from: opts.from });
        }
        if (opts?.to) {
            qb.andWhere("ir.created_at <= :to", { to: opts.to });
        }
        if (opts?.status !== undefined && opts.status !== null && !Number.isNaN(Number(opts.status))) {
            qb.andWhere("ir.status = :st", { st: Number(opts.status) });
        }

        const total = await qb.getCount();
        qb.skip((page - 1) * pageSize).take(pageSize);
        const rows = await qb.getMany();

        return {
            list: rows,
            total,
            page,
            pageSize,
        };
    }
}
