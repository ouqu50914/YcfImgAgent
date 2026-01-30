import { AiProvider, AiResponse, GenerateParams } from "./ai-provider.interface";
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { pipeline } from 'stream/promises'; // 用于下载文件流

export class DreamAdapter implements AiProvider {

    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] (Ark版) 开始调用... Prompt: ${params.prompt}`);

        // 1. 获取配置
        const ARK_API_KEY = process.env.SEED_ARK_API_KEY;
        const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps"; // 你的 Endpoint ID

        if (!ARK_API_KEY) throw new Error("❌ 未配置 ARK_API_KEY");

        // 2. 构造请求 (完全对应你的 curl)
        const url = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
        
        const requestBody = {
            model: MODEL_ID,
            prompt: params.prompt,
            sequential_image_generation: "disabled",
            response_format: "url", // API 返回 URL，我们需要下载
            size: "2K", // 对应 curl 中的 2K
            stream: false,
            watermark: false, // 设为 false 去水印，或者按需 true
            // 映射宽高参数 (Ark支持特定分辨率，这里简单映射)
            width: params.width || 1024,
            height: params.height || 1024
        };

        try {
            // 3. 发送请求 (Bearer Token 鉴权)
            console.log(`[DreamAPI] 发送请求至 ${url}...`);
            
            const response = await axios.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ARK_API_KEY}`
                },
                timeout: 60000 // 生图较慢，设置 60s 超时
            });

            // 4. 解析结果
            // Ark 返回格式参考 OpenAI: { data: [ { url: "..." } ], created: ... }
            const resData = response.data;
            
            if (!resData.data || resData.data.length === 0 || !resData.data[0].url) {
                console.error("[DreamAPI Error Response]", JSON.stringify(resData));
                throw new Error("API返回成功但未包含图片URL");
            }

            const imageUrl = resData.data[0].url;
            console.log(`[DreamAPI] 收到图片URL，准备下载: ${imageUrl}`);

            // 5. 下载并保存图片到本地 uploads
            const localUrl = await this.downloadAndSaveImage(imageUrl);

            return {
                original_id: resData.created ? String(resData.created) : uuidv4(),
                images: [localUrl]
            };

        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [DreamAPI Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`生图失败: ${error.message}`);
        }
    }

    // 辅助方法：下载图片并保存
    private async downloadAndSaveImage(remoteUrl: string): Promise<string> {
        const fileName = `dream_${uuidv4()}.png`;
        // process.cwd() 在 Backend 根目录下运行时，指向 Backend 目录
        // 所以这里是 Backend/uploads
        const uploadDir = path.join(process.cwd(), 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);

        // 下载流
        const response = await axios.get(remoteUrl, { responseType: 'stream' });
        
        // 写入文件
        await pipeline(response.data, fs.createWriteStream(filePath));
        
        console.log(`✅ [DreamAPI] 图片已保存至本地: ${fileName}`);
        
        // 返回给前端的相对路径
        return `/uploads/${fileName}`;
    }
}