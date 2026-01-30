import { AppDataSource } from "../data-source";
import { ImageResult } from "../entities/ImageResult";
import { ApiConfig } from "../entities/ApiConfig";
import { DreamAdapter } from "../adapters/dream.adapter";
import { NanoAdapter } from "../adapters/nano.adapter";
import { GenerateParams } from "../adapters/ai-provider.interface";

export class ImageService {
    private imageRepo = AppDataSource.getRepository(ImageResult);
    private configRepo = AppDataSource.getRepository(ApiConfig);

    private adapters = {
        'dream': new DreamAdapter(),
        'nano': new NanoAdapter()
    };

    async generate(userId: number, apiType: 'dream' | 'nano', params: GenerateParams) {
        // 1. 获取API配置
        const config = await this.configRepo.findOneBy({ api_type: apiType });
        if (!config || config.status === 0) {
            throw new Error(`API服务 [${apiType}] 未启用或配置不存在`);
        }

        // 2. 检查额度 (简单实现)
        if (config.used_quota >= config.user_daily_limit * 100) { // 假设总额度逻辑
            // 实际逻辑应该是检查该 user_daily_quota 表
            // 这里暂时跳过，先跑通流程
        }

        // 3. 调用适配器
        const adapter = this.adapters[apiType];
        if (!adapter) throw new Error("未知的API类型");

        try {
            // 调用 Mock 的适配器
            const result = await adapter.generateImage(params, config.api_key, config.api_url);

            // 4. 保存结果到数据库
            const imageRecord = new ImageResult();
            imageRecord.user_id = userId;
            imageRecord.api_type = apiType;
            imageRecord.prompt = params.prompt;
            // 假设直接返回了图片链接 (Mock)
            const firstImageUrl = result.images?.[0];
            if (firstImageUrl !== undefined) {
                imageRecord.image_url = firstImageUrl;
            }
            imageRecord.status = 1;

            await this.imageRepo.save(imageRecord);

            // 更新额度统计 (简单+1)
            config.used_quota += 1;
            await this.configRepo.save(config);

            return imageRecord;
        } catch (error) {
            console.error("生图失败:", error);
            throw new Error(`${apiType} 生图失败，请稍后重试`);
        }
    }
}