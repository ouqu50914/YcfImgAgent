import { AppDataSource } from "../data-source";
import { ImageResult } from "../entities/ImageResult";
import { ApiConfig } from "../entities/ApiConfig";
import { DreamAdapter } from "../adapters/dream.adapter";
import { NanoAdapter } from "../adapters/nano.adapter";
import { GenerateParams, UpscaleParams, ExtendParams, SplitParams } from "../adapters/ai-provider.interface";
import { CreditService, type CreditLogInfo } from "./credit.service";

export class ImageService {
    private imageRepo = AppDataSource.getRepository(ImageResult);
    private configRepo = AppDataSource.getRepository(ApiConfig);
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

        const result = await this.deductAndExecute(userId, cost, async () => {
            const apiResult = await adapter.generateImage(params, config.api_key, config.api_url);

            // 4. 保存结果到数据库
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;

            const firstImageUrl = apiResult.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;

            await this.imageRepo.save(imageRecord);

            const allImageUrls = apiResult.images || [];
            const actualGeneratedCount = allImageUrls.length;

            config.used_quota += actualGeneratedCount;
            await this.configRepo.save(config);

            return {
                ...imageRecord,
                all_images: allImageUrls
            } as any;
        }, { operationType: 'generate', apiType });

        return result;
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
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        }, { operationType: 'generate', apiType });

        return result;
    }
}
