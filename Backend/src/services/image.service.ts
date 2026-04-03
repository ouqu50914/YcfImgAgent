import { AppDataSource } from "../data-source";
import { ImageResult } from "../entities/ImageResult";
import { ApiConfig } from "../entities/ApiConfig";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { DreamAdapter } from "../adapters/dream.adapter";
import { NanoAdapter } from "../adapters/nano.adapter";
import { GenerateParams, UpscaleParams, ExtendParams, SplitParams } from "../adapters/ai-provider.interface";
import { CreditService, type CreditLogInfo } from "./credit.service";

export class ImageService {
    private imageRepo = AppDataSource.getRepository(ImageResult);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private creditService = new CreditService();

    private adapters = {
        'dream': new DreamAdapter(),
        'nano': new NanoAdapter()
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

    async generate(userId: number, apiType: 'dream' | 'nano', params: GenerateParams) {
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
            imageCount
        });

        // 3. 调用适配器（先扣积分，失败回滚）
        const adapter = this.adapters[apiType];
        if (!adapter) throw new Error("未知的API类型");

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
            imageRecord.template_id = params.templateId != null ? params.templateId : null;
            imageRecord.credits_spent = cost;
            imageRecord.operation_type = "generate";
            await this.imageRepo.save(imageRecord);

            try {
                // 2) 调用适配器生成图片
                const apiResult = await adapter.generateImage(params, config.api_key, config.api_url);

                // 3) 保存结果到数据库
                const allImageUrls = apiResult.images || [];
                const actualGeneratedCount = allImageUrls.length;

                const firstImageUrl = allImageUrls[0];
                if (firstImageUrl !== undefined) {
                    imageRecord.image_url = firstImageUrl;
                }

                imageRecord.status = 1;
                imageRecord.all_images = JSON.stringify(allImageUrls);
                await this.imageRepo.save(imageRecord);

                config.used_quota += actualGeneratedCount;
                await this.configRepo.save(config);

                return {
                    ...imageRecord,
                    all_images: allImageUrls,
                } as any;
            } catch (error) {
                // 生成失败：标记失败态（status=2），避免前端靠等待时间“猜测”失败。
                imageRecord.status = 2;
                imageRecord.all_images = imageRecord.all_images ?? null;
                await this.imageRepo.save(imageRecord);
                throw error;
            }
        }, { operationType: 'generate', apiType });

        return result;
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
        } = {
            id: Number(rec.id),
            status: rec.status,
            all_images: allImages,
            created_at: rec.created_at,
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
            const firstImageUrl = apiResult.images?.[0];
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
            const firstImageUrl = apiResult.images?.[0];
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
            const firstImageUrl = apiResult.images?.[0];
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
    async generateWithFallback(userId: number, apiType: 'dream' | 'nano', params: GenerateParams, enableFallback: boolean = true): Promise<ImageResult> {
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
            const firstImageUrl = apiResult.images?.[0];
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
