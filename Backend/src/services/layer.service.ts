import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
import { CreditService } from './credit.service';

export class LayerService {
    private creditService = new CreditService();

    /**
     * 拆分图片图层（使用Seedream API实现）
     */
    async splitImage(userId: number, imageUrl: string) {
        const cost = this.creditService.calcCost('dream', 'layer_split');
        await this.creditService.deductCredits(userId, cost, { operationType: 'layer_split', apiType: 'dream' });

        const ARK_API_KEY = process.env.SEED_ARK_API_KEY;
        const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps";
        const BASE_URL = "https://ark.cn-beijing.volces.com";

        if (!ARK_API_KEY) {
            throw new Error("❌ 未配置 SEED_ARK_API_KEY");
        }

        try {
            // 1. 下载图片到临时文件
            const imagePath = await this.downloadImageToTemp(imageUrl);
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');

            // 2. 构建图层分离提示词
            const layerPrompt = "将图片分离为多个图层，包括前景主体和背景，每个图层保持完整和清晰";

            // 3. 计算目标尺寸
            const dimensions = await this.getImageDimensions(imageUrl);
            let targetWidth = dimensions?.width || 1024;
            let targetHeight = dimensions?.height || 1024;

            const targetSize = `${targetWidth}x${targetHeight}`;
            console.log(`[LayerService] 使用Seedream API实现图层分离，目标尺寸: ${targetSize}`);

            // 4. 调用Seedream API
            const url = `${BASE_URL}/api/v3/images/generations`;
            const requestBody: any = {
                model: MODEL_ID,
                prompt: layerPrompt,
                image: `data:image/png;base64,${imageBase64}`,
                n: 1,
                response_format: "url",
                size: targetSize,
                stream: false,
                watermark: false,
            };

            const response = await axios.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ARK_API_KEY}`
                },
                timeout: 120000
            });

            // 5. 处理响应结果
            const resData = response.data;
            if (!resData.data || resData.data.length === 0 || !resData.data[0].url) {
                throw new Error("API返回成功但未包含图片URL");
            }

            // 6. 下载并保存分离后的图层
            const localUrl = await this.downloadAndSaveImage(resData.data[0].url, 'layer');
            console.log(`[LayerService] ✅ 图层分离成功: ${localUrl}`);

            // 7. 构建图层数据
            const layers = [
                {
                    index: 1,
                    url: localUrl,
                    name: '分离图层',
                    type: 'separated'
                }
            ];

            return {
                originalImageUrl: imageUrl,
                layers: layers,
                layerCount: layers.length
            };
        } catch (error: any) {
            await this.creditService.addCredits(userId, cost);
            const errInfo = error.response?.data || error.message;
            console.error("❌ [LayerService] 图层分离失败", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图层分离失败: ${error.message}`);
        }
    }

    /**
     * 获取图片尺寸
     */
    private async getImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
        try {
            // 简化实现：直接返回默认尺寸，避免依赖sharp
            // 实际项目中可以使用其他方式获取图片尺寸
            console.log('[LayerService] 使用默认图片尺寸');
            return { width: 1024, height: 1024 };
        } catch (error) {
            console.error('[LayerService] 获取图片尺寸失败:', error);
            return null;
        }
    }

    /**
     * 下载图片到临时文件
     */
    private async downloadImageToTemp(imageUrl: string): Promise<string> {
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const fileName = `temp_${uuidv4()}.png`;
        const filePath = path.join(tempDir, fileName);

        // 处理本地URL
        if (imageUrl.startsWith('/uploads/')) {
            const localPath = path.join(process.cwd(), imageUrl);
            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, filePath);
                return filePath;
            }
        }

        // 从网络下载
        if (imageUrl.startsWith('http')) {
            const response = await axios.get(imageUrl, {
                responseType: 'stream',
                timeout: 30000
            });
            await pipeline(response.data, fs.createWriteStream(filePath));
            return filePath;
        }

        throw new Error(`无法处理图片URL: ${imageUrl}`);
    }

    /**
     * 下载并保存图片
     */
    private async downloadAndSaveImage(remoteUrl: string, prefix: string = 'layer'): Promise<string> {
        const fileName = `${prefix}_${uuidv4()}.png`;
        const uploadDir = path.join(process.cwd(), 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);

        const response = await axios.get(remoteUrl, { 
            responseType: 'stream',
            timeout: 30000
        });
        
        await pipeline(response.data, fs.createWriteStream(filePath));
        
        return `/uploads/${fileName}`;
    }
}
