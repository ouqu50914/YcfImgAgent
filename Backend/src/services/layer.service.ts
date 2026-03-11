import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../data-source';
import { ApiConfig } from '../entities/ApiConfig';
import { DreamAdapter } from '../adapters/dream.adapter';
import { CreditService } from './credit.service';
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from './cos.service';

export class LayerService {
    private creditService = new CreditService();

    /**
     * 拆分图片图层（通过 Dream 适配器调用 Seedream API，与 image 服务共用同一后端 Ace/Ark）
     */
    async splitImage(userId: number, imageUrl: string) {
        const cost = this.creditService.calcCost('dream', 'layer_split');
        await this.creditService.deductCredits(userId, cost, { operationType: 'layer_split', apiType: 'dream' });

        const configRepo = AppDataSource.getRepository(ApiConfig);
        const config = await configRepo.findOne({
            where: { api_type: 'dream' },
            select: ['id', 'api_type', 'api_url', 'api_key', 'status'],
        });
        if (!config || config.status === 0) {
            throw new Error('API服务 [dream] 未启用或配置不存在');
        }

        try {
            const layerPrompt = '将图片分离为多个图层，包括前景主体和背景，每个图层保持完整和清晰';
            const dimensions = await this.getImageDimensions(imageUrl);
            const width = dimensions?.width ?? 1024;
            const height = dimensions?.height ?? 1024;

            console.log(`[LayerService] 使用 Dream 适配器实现图层分离，目标尺寸: ${width}x${height}`);

            const adapter = new DreamAdapter();
            const result = await adapter.generateImage(
                {
                    prompt: layerPrompt,
                    imageUrl,
                    width,
                    height,
                },
                config.api_key,
                config.api_url
            );

            const localUrl = result.images?.[0];
            if (!localUrl) {
                throw new Error('图层分离未返回图片');
            }
            console.log(`[LayerService] ✅ 图层分离成功: ${localUrl}`);

            const layers = [
                {
                    index: 1,
                    url: localUrl,
                    name: '分离图层',
                    type: 'separated',
                },
            ];

            return {
                originalImageUrl: imageUrl,
                layers,
                layerCount: layers.length,
            };
        } catch (error: any) {
            await this.creditService.addCredits(userId, cost);
            const errInfo = error.response?.data ?? error.message;
            console.error('❌ [LayerService] 图层分离失败', typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图层分离失败: ${error.message}`);
        }
    }

    /**
     * 获取图片尺寸（默认 1024x1024，避免强依赖 sharp）
     */
    private async getImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
        try {
            console.log('[LayerService] 使用默认图片尺寸');
            return { width: 1024, height: 1024 };
        } catch {
            return null;
        }
    }

    private async getImageBuffer(imageUrl: string): Promise<Buffer> {
        const pathPart = imageUrl.startsWith('http') && imageUrl.includes('/uploads/') ? new URL(imageUrl).pathname : imageUrl;
        if (pathPart.startsWith('/uploads/') || pathPart.includes('/uploads/')) {
            return getFileContent(pathPart.startsWith('/') ? pathPart : `/${pathPart}`);
        }
        if (imageUrl.startsWith('http')) {
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 1800000 });
            return Buffer.from(response.data);
        }
        const localPath = path.join(process.cwd(), imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl);
        return fs.promises.readFile(localPath);
    }

    private async downloadAndSaveImage(remoteUrl: string, prefix: string = 'layer'): Promise<string> {
        const fileName = `${prefix}_${uuidv4()}.png`;
        const response = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 1800000 });
        const buffer = Buffer.from(response.data);

        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, 'image/png');
            return `/uploads/${fileName}`;
        }
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }
}
