import { AiProvider, AiResponse, GenerateParams, UpscaleParams, ExtendParams } from "./ai-provider.interface";
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { pipeline } from 'stream/promises';

export class NanoAdapter implements AiProvider {
    // 1. 主入口方法：生图
    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始调用... Prompt: ${params.prompt}`);

        // 如果没有配置真实的API URL，使用Mock模式
        if (!apiUrl || apiUrl.includes('placeholder') || !apiKey || apiKey.includes('placeholder')) {
            console.log(`[NanoAPI] 使用Mock模式（未配置真实API）`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return {
                original_id: `nano_task_${Date.now()}`,
                images: [`https://via.placeholder.com/${params.width || 1024}x${params.height || 1024}.png?text=Nano+AI+Result`]
            };
        }

        // 兼容 numImages (前端) 和 num_images (后端接口定义)
        const count = params.num_images || (params as any).numImages || 1;
        console.log(`[NanoAPI] 收到请求: Prompt="${params.prompt}", 数量=${count}`);

        // 如果是多图，使用并发请求
        if (count > 1) {
            console.log(`[NanoAPI] 检测到多图需求 (${count}张) -> 切换为并发模式`);
            return this.generateImagesInParallel(params, count, apiKey, apiUrl);
        }

        try {
            // 处理参考图
            const hasSingleImage = !!params.imageUrl;
            const hasMultipleImages = !!(params.imageUrls && params.imageUrls.length > 0);
            
            // 构造请求体（根据nano API实际格式调整）
            const requestBody: any = {
                prompt: params.prompt || '基于参考图片生成',
                width: params.width || 1024,
                height: params.height || 1024,
                num_images: 1,
                style: params.style
            };

            // 处理参考图片
            if (hasMultipleImages && params.imageUrls && params.imageUrls.length > 0) {
                // 多图生成单图：将所有图片转换为 base64 数组
                console.log(`[NanoAPI] 多图生成单图模式，共 ${params.imageUrls.length} 张参考图`);
                const imagePromises = params.imageUrls.map(async (url) => {
                    // 如果是完整的 HTTP/HTTPS URL，直接使用（API 可能支持）
                    // 否则转换为 base64
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        // 检查是否是外部可访问的 URL
                        const urlObj = new URL(url);
                        // 如果是 localhost 或 127.0.0.1，API 服务器无法访问，需要转换为 base64
                        if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                            console.log(`[NanoAPI] 本地 URL，转换为 base64: ${url}`);
                            const imagePath = await this.downloadImageToTemp(url);
                            const imageBuffer = fs.readFileSync(imagePath);
                            return `data:image/png;base64,${imageBuffer.toString('base64')}`;
                        } else {
                            // 外部可访问的 URL，直接使用
                            console.log(`[NanoAPI] 使用外部 URL: ${url}`);
                            return url;
                        }
                    } else {
                        // 本地路径或相对路径，转换为 base64
                        const imagePath = await this.downloadImageToTemp(url);
                        const imageBuffer = fs.readFileSync(imagePath);
                        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
                    }
                });
                requestBody.image = await Promise.all(imagePromises);
                console.log(`[NanoAPI] 已准备 ${requestBody.image.length} 张参考图`);
            } else if (hasSingleImage && params.imageUrl) {
                // 单图生成：使用单张图片
                const imagePath = await this.downloadImageToTemp(params.imageUrl);
                const imageBuffer = fs.readFileSync(imagePath);
                requestBody.image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
            }

            console.log(`[NanoAPI] 发送请求至 ${apiUrl}...`);
            
            const response = await axios.post(apiUrl, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 120000
            });

            // 解析结果（支持多种响应格式）
            const resData = response.data;
            let imageUrl: string | undefined;
            
            // 尝试多种可能的响应格式
            if (resData.data && Array.isArray(resData.data) && resData.data.length > 0) {
                imageUrl = resData.data[0].url || resData.data[0].image_url;
            } else if (resData.data && resData.data.url) {
                imageUrl = resData.data.url;
            } else if (resData.images && Array.isArray(resData.images) && resData.images.length > 0) {
                imageUrl = resData.images[0].url || resData.images[0];
            } else if (resData.image_url) {
                imageUrl = resData.image_url;
            } else if (resData.url) {
                imageUrl = resData.url;
            }

            if (!imageUrl) {
                console.error("[NanoAPI Error Response]", JSON.stringify(resData));
                throw new Error("API返回成功但未包含图片URL");
            }

            console.log(`[NanoAPI] 收到图片URL，准备下载: ${imageUrl}`);

            // 下载并保存图片到本地
            const localUrl = await this.downloadAndSaveImage(imageUrl, 'nano');

            return {
                original_id: resData.task_id || resData.id || resData.created || `nano_${Date.now()}`,
                images: [localUrl]
            };

        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [NanoAPI Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`Nano生图失败: ${error.message}`);
        }
    }

    // 2. 并发处理方法
    private async generateImagesInParallel(
        params: GenerateParams, 
        count: number, 
        apiKey: string, 
        apiUrl: string
    ): Promise<AiResponse> {
        const actualCount = Math.min(count, 4); // 限制最大并发
        console.log(`[NanoAPI] 启动并发任务: ${actualCount} 个线程`);

        const tasks = Array(actualCount).fill(0).map((_, index) => {
            return (async () => {
                try {
                    const newParams = { 
                        ...params, 
                        num_images: 1,
                        numImages: 1 
                    };
                    
                    const singleResult = await this.generateImage(newParams, apiKey, apiUrl);
                    if (!singleResult.images || singleResult.images.length === 0) {
                        throw new Error("生成结果中没有图片");
                    }
                    return singleResult.images[0];
                } catch (e: any) {
                    console.error(`[NanoAPI] 子任务 #${index + 1} 失败:`, e.message);
                    return null;
                }
            })();
        });

        const results = await Promise.all(tasks);
        const successUrls = results.filter((url): url is string => !!url);

        if (successUrls.length === 0) throw new Error("并发生成全部失败");

        console.log(`[NanoAPI] 并发汇总: 成功 ${successUrls.length} 张`);

        return {
            original_id: `nano_parallel_${Date.now()}`,
            images: successUrls
        };
    }

    async upscaleImage(params: UpscaleParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始放大图片，倍数: ${params.scale || 2}`);

        if (!apiUrl || apiUrl.includes('placeholder') || !apiKey || apiKey.includes('placeholder')) {
            console.log(`[NanoAPI] 使用Mock模式（未配置真实API）`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return {
                original_id: `nano_upscale_${Date.now()}`,
                images: [params.imageUrl]
            };
        }

        try {
            // 下载原图并转换为base64
            const imagePath = await this.downloadImageToTemp(params.imageUrl);
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');

            // 计算放大后的尺寸
            const scale = params.scale || 2;
            const targetSize = scale === 4 ? "2048x2048" : "1536x1536";

            console.log(`[NanoAPI] 使用图生图模式实现放大，目标尺寸: ${targetSize}`);

            // 使用图生图模式实现放大
            const requestBody: any = {
                prompt: "保持原图风格和内容，提高分辨率和细节",
                image: `data:image/png;base64,${imageBase64}`,
                width: scale === 4 ? 2048 : 1536,
                height: scale === 4 ? 2048 : 1536,
                num_images: 1
            };

            const response = await axios.post(apiUrl, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 120000
            });

            const resData = response.data;
            let imageUrl: string | undefined;

            if (resData.data && Array.isArray(resData.data) && resData.data.length > 0) {
                imageUrl = resData.data[0].url || resData.data[0].image_url;
            } else if (resData.data && resData.data.url) {
                imageUrl = resData.data.url;
            } else if (resData.image_url) {
                imageUrl = resData.image_url;
            } else if (resData.url) {
                imageUrl = resData.url;
            }

            if (!imageUrl) {
                throw new Error("API返回成功但未包含图片URL");
            }

            const localUrl = await this.downloadAndSaveImage(imageUrl, 'nano');
            console.log(`[NanoAPI] ✅ 图片放大成功: ${localUrl}`);

            return {
                original_id: resData.task_id || resData.id || `nano_upscale_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [NanoAPI Upscale Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图片放大失败: ${error.message}`);
        }
    }

    async extendImage(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始扩展图片，方向: ${params.direction}`);

        if (!apiUrl || apiUrl.includes('placeholder') || !apiKey || apiKey.includes('placeholder')) {
            console.log(`[NanoAPI] 使用Mock模式（未配置真实API）`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return {
                original_id: `nano_extend_${Date.now()}`,
                images: [params.imageUrl]
            };
        }

        try {
            // 下载原图并转换为base64
            const imagePath = await this.downloadImageToTemp(params.imageUrl);
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');

            // 根据扩展方向计算新尺寸
            let targetWidth = params.width || 1024;
            let targetHeight = params.height || 1024;
            let extendPrompt = params.prompt || "";

            // 根据比例计算尺寸（如果提供了ratio）
            if (params.ratio && params.ratio !== 'auto') {
                const ratioMap: Record<string, { width: number; height: number }> = {
                    '1:1': { width: 1024, height: 1024 },
                    '4:3': { width: 1366, height: 1024 },
                    '3:4': { width: 1024, height: 1366 },
                    '16:9': { width: 1920, height: 1080 },
                    '9:16': { width: 1080, height: 1920 },
                    '3:2': { width: 1536, height: 1024 },
                    '2:3': { width: 1024, height: 1536 },
                    '21:9': { width: 2560, height: 1080 }
                };
                const ratioSize = ratioMap[params.ratio];
                if (ratioSize) {
                    targetWidth = ratioSize.width;
                    targetHeight = ratioSize.height;
                }
            }

            switch (params.direction) {
                case 'top':
                    targetHeight = Math.floor(targetHeight * 1.5);
                    extendPrompt = extendPrompt || "向上扩展画面，保持风格一致";
                    break;
                case 'bottom':
                    targetHeight = Math.floor(targetHeight * 1.5);
                    extendPrompt = extendPrompt || "向下扩展画面，保持风格一致";
                    break;
                case 'left':
                    targetWidth = Math.floor(targetWidth * 1.5);
                    extendPrompt = extendPrompt || "向左扩展画面，保持风格一致";
                    break;
                case 'right':
                    targetWidth = Math.floor(targetWidth * 1.5);
                    extendPrompt = extendPrompt || "向右扩展画面，保持风格一致";
                    break;
                case 'all':
                    // 全周扩展：四周都扩展，尺寸增加约1.5倍
                    targetWidth = Math.floor(targetWidth * 1.5);
                    targetHeight = Math.floor(targetHeight * 1.5);
                    extendPrompt = extendPrompt || "向四周扩展画面，保持风格一致，无缝衔接";
                    break;
            }

            console.log(`[NanoAPI] 使用图生图模式实现扩展，方向: ${params.direction}, 目标尺寸: ${targetWidth}x${targetHeight}`);

            const requestBody: any = {
                prompt: extendPrompt,
                image: `data:image/png;base64,${imageBase64}`,
                width: targetWidth,
                height: targetHeight,
                num_images: 1
            };

            const response = await axios.post(apiUrl, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 120000
            });

            const resData = response.data;
            let imageUrl: string | undefined;

            if (resData.data && Array.isArray(resData.data) && resData.data.length > 0) {
                imageUrl = resData.data[0].url || resData.data[0].image_url;
            } else if (resData.data && resData.data.url) {
                imageUrl = resData.data.url;
            } else if (resData.image_url) {
                imageUrl = resData.image_url;
            } else if (resData.url) {
                imageUrl = resData.url;
            }

            if (!imageUrl) {
                throw new Error("API返回成功但未包含图片URL");
            }

            const localUrl = await this.downloadAndSaveImage(imageUrl, 'nano');
            console.log(`[NanoAPI] ✅ 图片扩展成功: ${localUrl}`);

            return {
                original_id: resData.task_id || resData.id || `nano_extend_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [NanoAPI Extend Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图片扩展失败: ${error.message}`);
        }
    }

    // 辅助方法：下载图片并保存
    private async downloadAndSaveImage(remoteUrl: string, prefix: string = 'nano'): Promise<string> {
        const fileName = `${prefix}_${uuidv4()}.png`;
        const uploadDir = path.join(process.cwd(), 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);

        // 下载流
        const response = await axios.get(remoteUrl, { 
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5
        });
        
        // 写入文件
        await pipeline(response.data, fs.createWriteStream(filePath));
        
        console.log(`✅ [NanoAPI] 图片已保存至本地: ${fileName}`);

        // 添加水印（如果启用）
        if (process.env.ENABLE_WATERMARK === 'true') {
            try {
                await this.addWatermarkIfEnabled(filePath);
            } catch (error: any) {
                console.warn('[NanoAPI] 添加水印失败，继续使用原图:', error.message);
            }
        }
        
        // 返回给前端的相对路径
        return `/uploads/${fileName}`;
    }

    // 添加水印（如果sharp可用）
    private async addWatermarkIfEnabled(imagePath: string): Promise<void> {
        try {
            // 动态导入sharp，如果未安装则跳过
            // @ts-ignore - sharp是可选依赖
            const sharpModule = await import('sharp').catch(() => null);
            if (!sharpModule || !sharpModule.default) {
                return; // sharp未安装，跳过水印
            }

            const sharp = sharpModule.default;
            const watermarkText = process.env.WATERMARK_TEXT || '内部AI生图工具';
            const image = sharp(imagePath);
            const metadata = await image.metadata();
            const width = metadata.width || 1024;
            const height = metadata.height || 1024;

            // 创建水印文本SVG
            const fontSize = Math.max(24, Math.floor(width / 40));
            const svgWatermark = `
                <svg width="${width}" height="${height}">
                    <text 
                        x="${width - 20}" 
                        y="${height - 20}" 
                        font-family="Arial, sans-serif" 
                        font-size="${fontSize}" 
                        fill="rgba(255, 255, 255, 0.7)" 
                        text-anchor="end"
                        stroke="rgba(0, 0, 0, 0.5)"
                        stroke-width="1"
                    >${watermarkText}</text>
                </svg>
            `;

            // 添加水印
            const watermarkedImage = await image
                .composite([
                    {
                        input: Buffer.from(svgWatermark),
                        top: 0,
                        left: 0
                    }
                ])
                .toBuffer();

            // 覆盖原图
            await fs.promises.writeFile(imagePath, watermarkedImage);
            console.log(`[NanoAPI] 水印已添加: ${imagePath}`);
        } catch (error: any) {
            // 如果sharp未安装或处理失败，静默跳过
            console.warn('[NanoAPI] 水印处理跳过:', error.message);
        }
    }

    // 辅助方法：下载图片到临时文件
    private async downloadImageToTemp(imageUrl: string): Promise<string> {
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const fileName = `temp_${uuidv4()}.png`;
        const filePath = path.join(tempDir, fileName);

        console.log(`[NanoAPI] 准备下载图片: ${imageUrl}`);

        let downloadUrl = imageUrl;

        // 处理不同类型的URL
        if (imageUrl.startsWith('http://localhost:') || imageUrl.startsWith('http://127.0.0.1:')) {
            const urlPath = new URL(imageUrl).pathname;
            const localPath = path.join(process.cwd(), urlPath);
            console.log(`[NanoAPI] 本地服务器URL，转换为本地路径: ${localPath}`);

            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, filePath);
                console.log(`[NanoAPI] 本地文件复制成功: ${filePath}`);
                return filePath;
            } else {
                const urlObj = new URL(imageUrl);
                const frontendPort = urlObj.port;
                const backendPort = process.env.PORT || '3000';

                if (frontendPort === '5173' || frontendPort === '5174') {
                    urlObj.port = backendPort;
                    downloadUrl = urlObj.toString();
                    console.log(`[NanoAPI] 前端URL转换为后端URL: ${downloadUrl}`);
                }
            }
        }

        // 如果是相对路径，转换为绝对路径
        if (imageUrl.startsWith('/uploads/')) {
            const localPath = path.join(process.cwd(), imageUrl);
            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, filePath);
                console.log(`[NanoAPI] 相对路径文件复制成功: ${filePath}`);
                return filePath;
            }
        }

        // 从网络下载
        if (downloadUrl.startsWith('http')) {
            try {
                console.log(`[NanoAPI] 从网络下载图片: ${downloadUrl}`);
                const response = await axios.get(downloadUrl, {
                    responseType: 'stream',
                    timeout: 30000,
                    maxRedirects: 5,
                    validateStatus: (status) => status >= 200 && status < 400
                });
                await pipeline(response.data, fs.createWriteStream(filePath));
                console.log(`[NanoAPI] 网络下载成功: ${filePath}`);
                return filePath;
            } catch (error: any) {
                console.error(`[NanoAPI] 网络下载失败:`, error.message);
                if (downloadUrl !== imageUrl && imageUrl.startsWith('http')) {
                    console.log(`[NanoAPI] 尝试使用原始URL下载: ${imageUrl}`);
                    try {
                        const response = await axios.get(imageUrl, {
                            responseType: 'stream',
                            timeout: 30000
                        });
                        await pipeline(response.data, fs.createWriteStream(filePath));
                        console.log(`[NanoAPI] 使用原始URL下载成功: ${filePath}`);
                        return filePath;
                    } catch (retryError: any) {
                        console.error(`[NanoAPI] 使用原始URL也失败:`, retryError.message);
                    }
                }
                throw new Error(`无法下载图片: ${error.message}`);
            }
        }

        // 尝试作为本地文件路径
        if (fs.existsSync(imageUrl)) {
            fs.copyFileSync(imageUrl, filePath);
            console.log(`[NanoAPI] 本地文件复制成功: ${filePath}`);
            return filePath;
        }

        throw new Error(`无法处理图片URL: ${imageUrl}`);
    }
}