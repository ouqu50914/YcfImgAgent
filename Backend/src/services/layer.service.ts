import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';

export class LayerService {
    /**
     * 拆分图片图层（对接魔搭Qwen-Image-Layered API）
     */
    async splitImage(userId: number, imageUrl: string) {
        const API_URL = process.env.MODELSCOPE_API_URL || 'https://api.modelscope.cn/api/v1/models';
        const API_KEY = process.env.MODELSCOPE_API_KEY;
        const MODEL_NAME = process.env.MODELSCOPE_LAYER_MODEL || 'qwen/Qwen-Image-Layered';

        if (!API_KEY) {
            // 如果没有配置API，返回Mock数据
            console.log('[LayerService] 未配置魔搭API，使用Mock模式');
            return this.mockSplitImage(imageUrl);
        }

        try {
            // 1. 下载图片到临时文件
            const imagePath = await this.downloadImageToTemp(imageUrl);
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');

            // 2. 调用魔搭API
            const response = await axios.post(
                `${API_URL}/${MODEL_NAME}/inference`,
                {
                    input: {
                        image: `data:image/png;base64,${imageBase64}`
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    timeout: 120000
                }
            );

            // 3. 处理响应结果
            const result = response.data;
            const layers = result.output?.layers || result.layers || [];

            // 4. 下载并保存分层图片
            const savedLayers = await Promise.all(
                layers.map(async (layer: any, index: number) => {
                    const layerUrl = layer.url || layer.image_url;
                    if (!layerUrl) return null;

                    const localUrl = await this.downloadAndSaveImage(layerUrl, `layer_${index + 1}`);
                    return {
                        index: index + 1,
                        url: localUrl,
                        name: layer.name || `图层 ${index + 1}`,
                        type: layer.type || 'unknown'
                    };
                })
            );

            const validLayers = savedLayers.filter((layer): layer is NonNullable<typeof layer> => layer !== null);

            return {
                originalImageUrl: imageUrl,
                layers: validLayers,
                layerCount: validLayers.length
            };
        } catch (error: any) {
            console.error('[LayerService] API调用失败:', error.message);
            // 降级到Mock模式
            return this.mockSplitImage(imageUrl);
        }
    }

    /**
     * Mock模式：返回模拟的分层结果
     */
    private async mockSplitImage(imageUrl: string) {
        // 返回原图作为唯一图层（Mock）
        return {
            originalImageUrl: imageUrl,
            layers: [
                {
                    index: 1,
                    url: imageUrl,
                    name: '背景图层',
                    type: 'background'
                }
            ],
            layerCount: 1
        };
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
