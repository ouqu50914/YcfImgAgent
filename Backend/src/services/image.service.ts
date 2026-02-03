import { AppDataSource } from "../data-source";
import { ImageResult } from "../entities/ImageResult";
import { ApiConfig } from "../entities/ApiConfig";
import { UserDailyQuota } from "../entities/UserDailyQuota";
import { DreamAdapter } from "../adapters/dream.adapter";
import { NanoAdapter } from "../adapters/nano.adapter";
import { GenerateParams, UpscaleParams, ExtendParams } from "../adapters/ai-provider.interface";

export class ImageService {
    private imageRepo = AppDataSource.getRepository(ImageResult);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private quotaRepo = AppDataSource.getRepository(UserDailyQuota);

    private adapters = {
        'dream': new DreamAdapter(),
        'nano': new NanoAdapter()
    };

    /**
     * 检查并获取用户当日限额记录
     * 如果日期变化，自动重置
     */
    private async getOrCreateDailyQuota(userId: number, apiType: string, dailyLimit: number): Promise<UserDailyQuota> {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 设置为当天0点

        // 查找今日限额记录
        let quota = await this.quotaRepo.findOne({
            where: {
                user_id: userId,
                api_type: apiType,
                date: today
            }
        });

        // 如果不存在，创建新记录
        if (!quota) {
            quota = new UserDailyQuota();
            quota.user_id = userId;
            quota.api_type = apiType;
            quota.date = today;
            quota.used_quota = 0;
            await this.quotaRepo.save(quota);
            console.log(`[ImageService] 为用户 ${userId} 创建新的每日限额记录 (${apiType})`);
        }

        return quota;
    }

    /**
     * 检查用户当日限额是否足够
     */
    private async checkUserQuota(userId: number, apiType: string, requiredCount: number, dailyLimit: number): Promise<void> {
        const quota = await this.getOrCreateDailyQuota(userId, apiType, dailyLimit);
        
        if (quota.used_quota + requiredCount > dailyLimit) {
            const remaining = dailyLimit - quota.used_quota;
            throw new Error(`今日${apiType === 'dream' ? '即梦AI' : 'Nano'}额度不足，剩余${remaining}次，需要${requiredCount}次`);
        }
    }

    /**
     * 更新用户当日使用量
     */
    private async updateUserQuota(userId: number, apiType: string, usedCount: number, dailyLimit: number): Promise<void> {
        const quota = await this.getOrCreateDailyQuota(userId, apiType, dailyLimit);
        quota.used_quota += usedCount;
        await this.quotaRepo.save(quota);
        console.log(`[ImageService] 用户 ${userId} ${apiType} 使用量更新: ${quota.used_quota}/${dailyLimit}`);
    }

    async generate(userId: number, apiType: 'dream' | 'nano', params: GenerateParams) {
        // 1. 获取API配置
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        // 2. 计算需要生成的图片数量
        const imageCount = params.num_images || (params as any).numImages || 1;
        const requiredCount = imageCount;

        // 3. 检查用户当日限额
        await this.checkUserQuota(userId, apiType, requiredCount, config.user_daily_limit);

        // 4. 调用适配器
        const adapter = this.adapters[apiType];
        if (!adapter) throw new Error("未知的API类型");

        try {
            // 调用适配器生成图片
            const result = await adapter.generateImage(params, config.api_key, config.api_url);

            // 5. 保存结果到数据库（支持多图）
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;
            
            // 保存第一张图片作为主图
            const firstImageUrl = result.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;

            await this.imageRepo.save(imageRecord);

            // 如果有多张图片，将其他图片URL也返回（前端可以显示）
            const allImageUrls = result.images || [];
            const actualGeneratedCount = allImageUrls.length;

            // 6. 更新用户当日使用量
            await this.updateUserQuota(userId, apiType, actualGeneratedCount, config.user_daily_limit);

            // 7. 更新全局额度统计（可选，用于监控）
            config.used_quota += actualGeneratedCount;
            await this.configRepo.save(config);

            // 返回结果，包含所有图片URL
            return {
                ...imageRecord,
                all_images: allImageUrls // 添加所有图片URL
            } as any;
        } catch (error: any) {
            console.error("生图失败:", error);
            console.error("错误详情:", error.message);
            console.error("错误堆栈:", error.stack);
            throw new Error(`${apiType} 生图失败: ${error.message || '未知错误'}`);
        }
    }

    /**
     * 图片放大
     */
    async upscale(userId: number, apiType: 'dream' | 'nano', params: UpscaleParams, enableFallback: boolean = true): Promise<ImageResult> {
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            if (enableFallback) {
                // 自动降级到另一个API
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                console.log(`[ImageService] ${apiType}未启用，自动降级到${fallbackType}`);
                return this.upscale(userId, fallbackType, params, false); // 禁用再次降级，避免循环
            }
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        // 检查用户当日限额（放大算1次）
        await this.checkUserQuota(userId, apiType, 1, config.user_daily_limit);

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

        try {
            const result = await adapter.upscaleImage(params, config.api_key, config.api_url);
            
            // 保存结果
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = `放大图片 ${params.scale || 2}x`;
            const firstImageUrl = result.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            await this.imageRepo.save(imageRecord);

            // 更新用户当日使用量
            await this.updateUserQuota(userId, apiType, 1, config.user_daily_limit);

            // 更新全局额度统计
            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        } catch (error: any) {
            console.error(`[ImageService] ${apiType}放大失败:`, error);
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackConfig = await this.configRepo.findOneBy({ api_type: fallbackType });
                if (fallbackConfig && fallbackConfig.status === 1) {
                    console.log(`[ImageService] ${apiType}放大失败，自动降级到${fallbackType}`);
                    return this.upscale(userId, fallbackType, params, false);
                }
            }
            throw new Error(`图片放大失败: ${error.message}`);
        }
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

        // 检查用户当日限额（扩展算1次）
        await this.checkUserQuota(userId, apiType, 1, config.user_daily_limit);

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

        try {
            const result = await adapter.extendImage(params, config.api_key, config.api_url);
            
            // 保存结果
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = `扩展图片 ${params.direction}`;
            const firstImageUrl = result.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            await this.imageRepo.save(imageRecord);

            // 更新用户当日使用量
            await this.updateUserQuota(userId, apiType, 1, config.user_daily_limit);

            // 更新全局额度统计
            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        } catch (error: any) {
            console.error(`[ImageService] ${apiType}扩展失败:`, error);
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackConfig = await this.configRepo.findOneBy({ api_type: fallbackType });
                if (fallbackConfig && fallbackConfig.status === 1) {
                    console.log(`[ImageService] ${apiType}扩展失败，自动降级到${fallbackType}`);
                    return this.extend(userId, fallbackType, params, false);
                }
            }
            throw new Error(`图片扩展失败: ${error.message}`);
        }
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

        try {
            const result = await adapter.generateImage(params, config.api_key, config.api_url);
            
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;
            const firstImageUrl = result.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;
            await this.imageRepo.save(imageRecord);

            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        } catch (error: any) {
            console.error(`[ImageService] ${apiType}生图失败:`, error);
            if (enableFallback) {
                const fallbackType = apiType === 'dream' ? 'nano' : 'dream';
                const fallbackConfig = await this.configRepo.findOneBy({ api_type: fallbackType });
                if (fallbackConfig && fallbackConfig.status === 1) {
                    console.log(`[ImageService] ${apiType}生图失败，自动降级到${fallbackType}`);
                    return this.generateWithFallback(userId, fallbackType, params, false);
                }
            }
            throw new Error(`${apiType} 生图失败: ${error.message}`);
        }
    }
}