/**
 * 备份：火山引擎 Ark 版 Seedream 接入。
 * 恢复时可将本文件内容复制回 dream.adapter.ts，或通过开关切换引用。
 * 原文件：dream.adapter.ts（已改为 Ace 接入）
 */
import { AiProvider, AiResponse, GenerateParams, UpscaleParams, ExtendParams, SplitParams } from './ai-provider.interface';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from '../services/cos.service';

// 创建禁用代理的 axios 实例，确保 Dream API（火山引擎）与 Ace Nano API 不使用代理
const axiosNoProxy = axios.create({
    proxy: false
});

export class DreamAdapter implements AiProvider {

// 1. 主入口方法
async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
    const ARK_API_KEY = apiKey || process.env.SEED_ARK_API_KEY;
    const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps";
    const BASE_URL = "https://ark.cn-beijing.volces.com";

    if (!ARK_API_KEY) throw new Error("❌ 未配置 ARK_API_KEY");

    // 🔥🔥🔥 核心修复：兼容 numImages (前端) 和 num_images (后端接口定义)
    // 你的截图显示前端传的是 numImages，所以必须加上 params.numImages
    const count = params.num_images || (params as any).numImages || 1;
    
    console.log(`[DreamAPI] 收到请求: Prompt="${params.prompt}", 数量=${count}`);

    // --- 策略：如果是多图，使用并发请求替代 ---
    if (count > 1) {
        console.log(`[DreamAPI] 检测到多图需求 (${count}张) -> 切换为并发模式`);
        return this.generateImagesInParallel(params, count, ARK_API_KEY, MODEL_ID, BASE_URL);
    }

    // --- 以下为单图生成逻辑 ---
    
    // 确定使用的尺寸模式（图生图时如果没有指定尺寸，使用原图尺寸）
    const referenceImageUrl = params.imageUrl || (params.imageUrls && params.imageUrls.length > 0 ? params.imageUrls[0] : undefined);
    const sizeString = await this.getSizeString(params.width, params.height, params.quality, referenceImageUrl);
    const useQualityMode = params.quality && (params.quality === "1K" || params.quality === "2K" || params.quality === "4K");
    const modeInfo = useQualityMode 
        ? `方式1（分辨率模式）: ${params.quality}，宽高比由模型根据prompt判断`
        : `方式2（像素模式）: ${sizeString}`;
    
    console.log(`[DreamAPI] 尺寸配置: ${modeInfo}`);
    
    // 注意：前端已经将尺寸信息添加到提示词中，这里直接使用即可
    // 如果提示词中已包含尺寸信息，不需要再次添加
    
    const url = `${BASE_URL}/api/v3/images/generations`;
    const requestBody: any = {
        model: MODEL_ID,
        prompt: params.prompt, // 提示词已包含尺寸信息（由前端添加）
        response_format: "url",
        size: sizeString,
        watermark: false,
        sequential_image_generation: "disabled", 
        stream: false // 单图强制关闭流式，保证稳定
    };

    // 处理参考图
    const hasSingleImage = !!params.imageUrl;
    const hasMultipleImages = !!(params.imageUrls && params.imageUrls.length > 0);
    
    if (hasMultipleImages && params.imageUrls && params.imageUrls.length > 0) {
        // 多图生成单图：将所有图片处理为数组
        console.log(`[DreamAPI] 多图生成单图模式，共 ${params.imageUrls.length} 张参考图`);
        const imagePromises = params.imageUrls.map(async (url) => {
            // 如果是完整的 HTTP/HTTPS URL，直接使用（API 可能支持）
            // 否则转换为 base64
            if (url.startsWith('http://') || url.startsWith('https://')) {
                // 检查是否是外部可访问的 URL
                const urlObj = new URL(url);
                // 如果是 localhost 或 127.0.0.1，API 服务器无法访问，需要转换为 base64
                if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                    console.log(`[DreamAPI] 本地 URL，转换为 base64: ${url}`);
                    const imageBuffer = await this.getImageBuffer(url);
                    return `data:image/png;base64,${imageBuffer.toString('base64')}`;
                } else {
                    // 外部可访问的 URL，直接使用
                    console.log(`[DreamAPI] 使用外部 URL: ${url}`);
                    return url;
                }
            } else {
                const imageBuffer = await this.getImageBuffer(url);
                return `data:image/png;base64,${imageBuffer.toString('base64')}`;
            }
        });
        requestBody.image = await Promise.all(imagePromises);
        console.log(`[DreamAPI] 已准备 ${requestBody.image.length} 张参考图`);
    } else if (hasSingleImage && params.imageUrl) {
        const imageBuffer = await this.getImageBuffer(params.imageUrl);
        requestBody.image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    }

    try {
        console.log(`[DreamAPI] 发送单图API请求...`);
        const response = await axiosNoProxy.post(url, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ARK_API_KEY}`
            },
            timeout: 1800000
        });

        const resData = response.data;
        let imageUrl = "";
        
        // 解析标准JSON响应
        if (resData.data && resData.data.url) imageUrl = resData.data.url;
        else if (resData.data && Array.isArray(resData.data) && resData.data.length > 0) imageUrl = resData.data[0].url;
        else if (resData.images && resData.images.length > 0) imageUrl = resData.images[0].url;

        if (!imageUrl) {
            console.error("API响应异常:", JSON.stringify(resData));
            throw new Error("API返回成功但未包含图片URL");
        }

        const localUrl = await this.downloadAndSaveImage(imageUrl);
        console.log(`[DreamAPI] 单图生成完毕: ${localUrl}`);
        
        return {
            original_id: resData.created ? String(resData.created) : uuidv4(),
            images: [localUrl]
        };

    } catch (error: any) {
        console.error("❌ [DreamAPI Single Failed]", error.message);
        throw error;
    }
}

// 2. 并发处理方法
private async generateImagesInParallel(
    params: GenerateParams, 
    count: number, 
    apiKey: string, 
    modelId: string, 
    baseUrl: string
): Promise<AiResponse> {
    const actualCount = Math.min(count, 4); // 限制最大并发
    console.log(`[DreamAPI] 启动并发任务: ${actualCount} 个线程`);

    // 构造子任务
    const tasks = Array(actualCount).fill(0).map((_, index) => {
        return (async () => {
            try {
                // 🔥 递归调用：强制把数量覆盖为 1，防止无限递归
                // 同时覆盖 num_images 和 numImages 以防万一
                const newParams = { 
                    ...params, 
                    num_images: 1,
                    numImages: 1 
                };
                
                // 调用自身的 generateImage 方法
                const singleResult = await this.generateImage(newParams, apiKey, "");
                if (!singleResult.images || singleResult.images.length === 0) {
                    throw new Error("生成结果中没有图片");
                }
                return singleResult.images[0];
            } catch (e: any) {
                console.error(`[DreamAPI] 子任务 #${index + 1} 失败:`, e.message);
                return null;
            }
        })();
    });

    // 等待所有完成
    const results = await Promise.all(tasks);
    const successUrls = results.filter((url): url is string => !!url);

    if (successUrls.length === 0) throw new Error("并发生成全部失败");

    console.log(`[DreamAPI] 并发汇总: 成功 ${successUrls.length} 张`);

    return {
        original_id: uuidv4(),
        images: successUrls
    };
}

    // --- 核心修复：更健壮的流式响应解析 ---
    private async parseStreamResponse(stream: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];

            stream.on('data', (chunk: Buffer) => chunks.push(chunk));

            stream.on('end', () => {
                try {
                    const fullText = Buffer.concat(chunks).toString('utf-8');
                    const lines = fullText.split('\n');
                    const imageDataArray: any[] = [];

                    console.log(`[DreamAPI] 流式响应接收完毕，共 ${lines.length} 行数据，开始解析...`);

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine.startsWith('data: ') || trimmedLine.includes('[DONE]')) continue;

                        const jsonStr = trimmedLine.substring(6).trim();
                        if (!jsonStr) continue;

                        try {
                            const jsonData = JSON.parse(jsonStr);

                            // --- 核心修复：扁平化提取逻辑 ---
                            // 不再依赖 event.type 来决定提取位置，而是探测所有可能的位置

                            let foundUrl = null;
                            let foundIndex = null;

                            // 1. 优先检查标准 Seedream 结构: data.data.url
                            if (jsonData.data && jsonData.data.url) {
                                foundUrl = jsonData.data.url;
                                foundIndex = jsonData.data.image_index;
                            }
                            // 2. 检查 content 结构 (部分模型变体): data.content.url
                            else if (jsonData.content && jsonData.content.url) {
                                foundUrl = jsonData.content.url;
                                foundIndex = jsonData.content.image_index;
                            }
                            // 3. 检查根节点 (旧版或非标): data.url
                            else if (jsonData.url) {
                                foundUrl = jsonData.url;
                            }
                            // 4. 检查是否直接包含图片数组 (批量返回)
                            else if (jsonData.data && Array.isArray(jsonData.data)) {
                                console.log(`[DreamAPI] 单行包含多张图片数组: ${jsonData.data.length} 张`);
                                imageDataArray.push(...jsonData.data);
                                continue; // 已处理，跳过
                            }

                            // 如果提取到了 URL，就加入结果集
                            if (foundUrl) {
                                console.log(`[DreamAPI] ✅ 成功提取图片 (Index: ${foundIndex ?? 'N/A'})`);
                                imageDataArray.push({
                                    url: foundUrl,
                                    image_index: foundIndex ?? jsonData.image_index
                                });
                            } else {
                                // 调试日志：记录未提取到图片的事件类型（忽略 completed 和 usage 事件）
                                if (jsonData.type !== 'image_generation.completed' && !jsonData.usage) {
                                    // console.log(`[DreamAPI] 跳过无图片事件: ${jsonData.type}`);
                                }
                            }

                        } catch (e) {
                            const errorMessage = e instanceof Error ? e.message : String(e);
                            console.warn(`[DreamAPI] JSON解析警告: ${errorMessage}`);
                        }
                    }

                    if (imageDataArray.length > 0) {
                        console.log(`[DreamAPI] 解析完成，共提取到 ${imageDataArray.length} 张图片`);
                        resolve({ data: imageDataArray });
                    } else {
                        // 兜底：如果 SSE 解析失败（可能是非流式报错信息），尝试当做普通 JSON 解析
                        try {
                            console.log("[DreamAPI] SSE未提取到图片，尝试全量JSON解析兜底...");
                            const jsonFallback = JSON.parse(fullText);
                            resolve(jsonFallback);
                        } catch {
                            console.error("[DreamAPI] ❌ 无法从响应中解析出任何图片数据");
                            // 打印前 500 个字符帮助调试
                            console.error("响应内容预览:", fullText.substring(0, 500));
                            reject(new Error("无法从流式响应中提取图片数据"));
                        }
                    }
                } catch (error: any) {
                    reject(new Error(`解析流式响应失败: ${error.message}`));
                }
            });

            stream.on('error', (error: any) => {
                reject(new Error(`流式响应错误: ${error.message}`));
            });
        });
    }

    /** 根据 URL 或路径获取图片 Buffer（/uploads/ 从 COS 或本地读，http 下载，否则读本地文件） */
    private async getImageBuffer(imageUrl: string): Promise<Buffer> {
        const pathPart = imageUrl.startsWith('http') ? new URL(imageUrl).pathname : imageUrl;
        if (pathPart.includes('/uploads/')) {
            return getFileContent(pathPart);
        }
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            const response = await axiosNoProxy.get(imageUrl, { responseType: 'arraybuffer' });
            return Buffer.from(response.data);
        }
        const localPath = pathPart.startsWith('/') ? path.join(process.cwd(), pathPart) : path.join(process.cwd(), 'uploads', pathPart);
        return fs.promises.readFile(localPath);
    }

    // 辅助方法：获取图片尺寸（用于图生图时使用原图尺寸）
    private async getImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
        try {
            // 动态导入sharp
            // @ts-ignore - sharp是可选依赖
            const sharpModule = await import('sharp').catch(() => null);
            if (!sharpModule || !sharpModule.default) {
                console.warn('[DreamAPI] sharp未安装，无法获取图片尺寸');
                return null;
            }

            const sharp = sharpModule.default;
            
            // 判断是本地文件还是远程URL
            let imageBuffer: Buffer;
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                // 远程URL，需要下载
                const response = await axiosNoProxy.get(imageUrl, { responseType: 'arraybuffer' });
                imageBuffer = Buffer.from(response.data);
            } else {
                const pathPart = imageUrl.startsWith('http') ? new URL(imageUrl).pathname : imageUrl;
                if (pathPart.includes('/uploads/')) {
                    imageBuffer = await getFileContent(pathPart);
                } else {
                    let filePath = imageUrl.startsWith('/') ? path.join(process.cwd(), imageUrl) : path.join(process.cwd(), 'uploads', imageUrl);
                    if (!fs.existsSync(filePath)) {
                        console.warn(`[DreamAPI] 图片文件不存在: ${filePath}`);
                        return null;
                    }
                    imageBuffer = await fs.promises.readFile(filePath);
                }
            }

            const metadata = await sharp(imageBuffer).metadata();
            if (metadata.width && metadata.height) {
                console.log(`[DreamAPI] 获取到原图尺寸: ${metadata.width}x${metadata.height}`);
                return { width: metadata.width, height: metadata.height };
            }
            return null;
        } catch (error: any) {
            console.warn(`[DreamAPI] 获取图片尺寸失败: ${error.message}`);
            return null;
        }
    }

    // 辅助方法：将宽高转换为尺寸字符串
    // 豆包API支持两种方式：
    // 方式1：指定生成图像的分辨率（1K、2K、4K），在prompt中用自然语言描述图片宽高比
    // 方式2：指定生成图像的宽高像素值，需满足：
    //   - 总像素范围：[921600, 16777216]
    //   - 宽高比范围：[1/16, 16]
    private async getSizeString(width?: number, height?: number, quality?: string, imageUrl?: string): Promise<string> {
        // 方式1：如果指定了 quality（1K、2K、4K），直接使用
        if (quality && (quality === "1K" || quality === "2K" || quality === "4K")) {
            console.log(`[DreamAPI] 使用方式1（分辨率模式）: ${quality}`);
            return quality;
        }

        // 方式2：指定具体像素值
        // 如果图生图且没有指定尺寸，尝试使用原图尺寸
        if ((!width || !height) && imageUrl) {
            console.log(`[DreamAPI] 图生图模式，尝试获取原图尺寸...`);
            const dimensions = await this.getImageDimensions(imageUrl);
            if (dimensions) {
                width = dimensions.width;
                height = dimensions.height;
                console.log(`[DreamAPI] 使用原图尺寸: ${width}x${height}`);
            }
        }

        if (!width || !height) {
            // 默认使用推荐尺寸：2048x2048 (1:1)
            console.log(`[DreamAPI] 未指定尺寸，使用默认: 2048x2048`);
            return "2048x2048";
        }

        // 验证总像素范围：[921600, 16777216]
        const totalPixels = width * height;
        const minPixels = 921600;      // 最小总像素
        const maxPixels = 16777216;   // 最大总像素（4096x4096）

        // 验证宽高比范围：[1/16, 16]
        const aspectRatio = width / height;
        const minAspectRatio = 1 / 16;
        const maxAspectRatio = 16;

        // 检查是否同时满足两个条件
        const isValidPixels = totalPixels >= minPixels && totalPixels <= maxPixels;
        const isValidAspectRatio = aspectRatio >= minAspectRatio && aspectRatio <= maxAspectRatio;

        if (!isValidPixels || !isValidAspectRatio) {
            console.warn(`[DreamAPI] 尺寸 ${width}x${height} 不符合要求:`);
            console.warn(`  - 总像素: ${totalPixels} (要求: [${minPixels}, ${maxPixels}]) ${isValidPixels ? '✓' : '✗'}`);
            console.warn(`  - 宽高比: ${aspectRatio.toFixed(2)} (要求: [${minAspectRatio}, ${maxAspectRatio}]) ${isValidAspectRatio ? '✓' : '✗'}`);

            // 如果像素数不足，自动调整到最小尺寸（保持宽高比）
            if (totalPixels < minPixels) {
                const ratio = Math.sqrt(minPixels / totalPixels);
                width = Math.ceil(width * ratio);
                height = Math.ceil(height * ratio);
                console.log(`[DreamAPI] 自动调整到最小像素: ${width}x${height} (${width * height}像素)`);
            }

            // 如果像素数超过最大值，缩小到最大尺寸（保持宽高比）
            if (width * height > maxPixels) {
                const ratio = Math.sqrt(maxPixels / (width * height));
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
                console.log(`[DreamAPI] 自动调整到最大像素: ${width}x${height} (${width * height}像素)`);
            }

            // 如果宽高比不符合要求，调整到最接近的推荐尺寸
            const newAspectRatio = width / height;
            if (newAspectRatio < minAspectRatio || newAspectRatio > maxAspectRatio) {
                console.warn(`[DreamAPI] 宽高比 ${newAspectRatio.toFixed(2)} 不符合要求，使用推荐尺寸`);
                // 使用推荐的1:1尺寸
                width = 2048;
                height = 2048;
            }
        }

        // 验证调整后的尺寸是否满足要求
        const finalPixels = width * height;
        const finalAspectRatio = width / height;
        if (finalPixels < minPixels || finalPixels > maxPixels || finalAspectRatio < minAspectRatio || finalAspectRatio > maxAspectRatio) {
            console.warn(`[DreamAPI] 调整后尺寸仍不符合要求，使用默认尺寸`);
            width = 2048;
            height = 2048;
        }

        // 推荐的宽高像素值映射（根据文档）
        const recommendedSizes: Record<string, string> = {
            "2048x2048": "2048x2048",   // 1:1
            "2304x1728": "2304x1728",   // 4:3
            "1728x2304": "1728x2304",   // 3:4
            "2560x1440": "2560x1440",   // 16:9
            "1440x2560": "1440x2560",   // 9:16
            "2496x1664": "2496x1664",   // 3:2
            "1664x2496": "1664x2496",   // 2:3
            "3024x1296": "3024x1296",   // 21:9
        };

        const sizeKey = `${width}x${height}`;
        
        // 如果匹配推荐尺寸，直接返回
        if (recommendedSizes[sizeKey]) {
            console.log(`[DreamAPI] 使用推荐尺寸: ${sizeKey}`);
            return recommendedSizes[sizeKey];
        }

        // 否则返回计算后的尺寸（API应该也支持自定义尺寸）
        console.log(`[DreamAPI] 使用自定义尺寸: ${sizeKey} (${width * height}像素, 宽高比: ${(width / height).toFixed(2)})`);
        return sizeKey;
    }

    // 辅助方法：下载图片并保存（启用 COS 时只上传 COS 不落盘）
    private async downloadAndSaveImage(remoteUrl: string): Promise<string> {
        const fileName = `dream_${uuidv4()}.png`;
        const response = await axiosNoProxy.get(remoteUrl, { responseType: 'arraybuffer' });
        let buffer = Buffer.from(response.data);

        if (process.env.ENABLE_WATERMARK === 'true') {
            try {
                buffer = await this.addWatermarkToBuffer(buffer);
            } catch (error: any) {
                console.warn('[DreamAPI] 添加水印失败，继续使用原图:', error.message);
            }
        }

        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, 'image/png');
            console.log(`✅ [DreamAPI] 图片已上传至 COS: ${fileName}`);
            return `/uploads/${fileName}`;
        }

        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, fileName);
        await fs.promises.writeFile(filePath, buffer);
        console.log(`✅ [DreamAPI] 图片已保存至本地: ${fileName}`);
        return `/uploads/${fileName}`;
    }

    /** 对 Buffer 添加水印（用于 COS 路径不落盘时） */
    private async addWatermarkToBuffer(imageBuffer: Buffer): Promise<Buffer> {
        try {
            // sharp 为可选依赖，未安装时跳过
            const sharpMod = await Promise.resolve().then(() => require('sharp')).catch(() => null);
            if (!sharpMod) return imageBuffer;
            const sharp = sharpMod;
            const watermarkText = process.env.WATERMARK_TEXT || '内部AI生图工具';
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const width = metadata.width || 1024;
            const height = metadata.height || 1024;
            const fontSize = Math.max(24, Math.floor(width / 40));
            const svgWatermark = `
                <svg width="${width}" height="${height}">
                    <text x="${width - 20}" y="${height - 20}" font-family="Arial, sans-serif" font-size="${fontSize}"
                        fill="rgba(255, 255, 255, 0.7)" text-anchor="end" stroke="rgba(0, 0, 0, 0.5)" stroke-width="1">${watermarkText}</text>
                </svg>`;
            return await image.composite([{ input: Buffer.from(svgWatermark), top: 0, left: 0 }]).toBuffer();
        } catch (error: any) {
            console.warn('[DreamAPI] 水印处理跳过:', error.message);
            return imageBuffer;
        }
    }

    async upscaleImage(params: UpscaleParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始放大图片，倍数: ${params.scale || 2}`);

        const ARK_API_KEY = apiKey || process.env.SEED_ARK_API_KEY;
        const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps";
        const BASE_URL = "https://ark.cn-beijing.volces.com";

        if (!ARK_API_KEY) throw new Error("❌ 未配置 ARK_API_KEY");

        try {
            // Seedream API 通过图生图模式实现放大：使用原图作为参考，增大尺寸
            // 下载原图并转换为base64
            const imageBuffer = await this.getImageBuffer(params.imageUrl);
            const imageBase64 = imageBuffer.toString('base64');

            // 计算放大后的尺寸（假设原图是1024x1024，放大2倍是2048x2048，但API可能限制最大尺寸）
            // 根据Seedream API，可以使用 "2K" 尺寸参数
            const scale = params.scale || 2;
            const targetSize = scale === 4 ? "2048x2048" : "1536x1536"; // 2倍用1536，4倍用2048

            console.log(`[DreamAPI] 使用图生图模式实现放大，目标尺寸: ${targetSize}`);

            const url = `${BASE_URL}/api/v3/images/generations`;
            const requestBody: any = {
                model: MODEL_ID,
                prompt: "保持原图风格和内容，提高分辨率和细节", // 放大提示词
                image: `data:image/png;base64,${imageBase64}`,
                n: 1,
                response_format: "url",
                size: targetSize,
                stream: false,
                watermark: false,
            };

            const response = await axiosNoProxy.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ARK_API_KEY}`
                },
                timeout: 1800000
            });

            const resData = response.data;
            if (!resData.data || resData.data.length === 0 || !resData.data[0].url) {
                throw new Error("API返回成功但未包含图片URL");
            }

            const localUrl = await this.downloadAndSaveImage(resData.data[0].url);
            console.log(`[DreamAPI] ✅ 图片放大成功: ${localUrl}`);

            return {
                original_id: resData.created ? String(resData.created) : `dream_upscale_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [DreamAPI Upscale Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图片放大失败: ${error.message}`);
        }
    }

    async extendImage(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始扩展图片，方向: ${params.direction}`);

        const ARK_API_KEY = apiKey || process.env.SEED_ARK_API_KEY;
        const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps";
        const BASE_URL = "https://ark.cn-beijing.volces.com";

        if (!ARK_API_KEY) throw new Error("❌ 未配置 ARK_API_KEY");

        try {
            // Seedream API 通过图生图模式实现扩展：使用原图作为参考，调整尺寸和提示词
            // 下载原图并转换为base64
            const imageBuffer = await this.getImageBuffer(params.imageUrl);
            const imageBase64 = imageBuffer.toString('base64');

            // 根据扩展方向计算新尺寸
            // 假设原图是1024x1024，扩展后根据方向增加相应尺寸
            let targetSize = "1024x1024";
            let extendPrompt = params.prompt || "";

            // 根据比例计算尺寸（如果提供了ratio）
            let calculatedWidth = params.width || 1024;
            let calculatedHeight = params.height || 1024;
            
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
                    calculatedWidth = ratioSize.width;
                    calculatedHeight = ratioSize.height;
                }
            }

            // 根据方向调整尺寸和提示词
            switch (params.direction) {
                case 'top':
                    targetSize = `${calculatedWidth}x${Math.floor(calculatedHeight * 1.5)}`;
                    extendPrompt = extendPrompt || "向上扩展画面，保持风格一致";
                    break;
                case 'bottom':
                    targetSize = `${calculatedWidth}x${Math.floor(calculatedHeight * 1.5)}`;
                    extendPrompt = extendPrompt || "向下扩展画面，保持风格一致";
                    break;
                case 'left':
                    targetSize = `${Math.floor(calculatedWidth * 1.5)}x${calculatedHeight}`;
                    extendPrompt = extendPrompt || "向左扩展画面，保持风格一致";
                    break;
                case 'right':
                    targetSize = `${Math.floor(calculatedWidth * 1.5)}x${calculatedHeight}`;
                    extendPrompt = extendPrompt || "向右扩展画面，保持风格一致";
                    break;
                case 'all':
                    // 全周扩展：四周都扩展，尺寸增加约1.5倍
                    targetSize = `${Math.floor(calculatedWidth * 1.5)}x${Math.floor(calculatedHeight * 1.5)}`;
                    extendPrompt = extendPrompt || "向四周扩展画面，保持风格一致，无缝衔接";
                    break;
            }

            console.log(`[DreamAPI] 使用图生图模式实现扩展，方向: ${params.direction}, 目标尺寸: ${targetSize}`);

            const url = `${BASE_URL}/api/v3/images/generations`;
            const requestBody: any = {
                model: MODEL_ID,
                prompt: extendPrompt,
                image: `data:image/png;base64,${imageBase64}`,
                n: 1,
                response_format: "url",
                size: targetSize,
                stream: false,
                watermark: false,
            };

            const response = await axiosNoProxy.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ARK_API_KEY}`
                },
                timeout: 1800000
            });

            const resData = response.data;
            if (!resData.data || resData.data.length === 0 || !resData.data[0].url) {
                throw new Error("API返回成功但未包含图片URL");
            }

            const localUrl = await this.downloadAndSaveImage(resData.data[0].url);
            console.log(`[DreamAPI] ✅ 图片扩展成功: ${localUrl}`);

            return {
                original_id: resData.created ? String(resData.created) : `dream_extend_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [DreamAPI Extend Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图片扩展失败: ${error.message}`);
        }
    }

    async splitImage(params: SplitParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始拆分图片，数量: ${params.splitCount || 2}, 方向: ${params.splitDirection || 'horizontal'}`);

        const ARK_API_KEY = apiKey || process.env.SEED_ARK_API_KEY;
        const MODEL_ID = process.env.SEED_ARK_MODEL_ID || "ep-20260129215218-w29ps";
        const BASE_URL = "https://ark.cn-beijing.volces.com";

        if (!ARK_API_KEY) throw new Error("❌ 未配置 ARK_API_KEY");

        try {
            // Seedream API 通过图生图模式实现图片拆分：使用原图作为参考，通过提示词指导拆分
            // 下载原图并转换为base64
            const imageBuffer = await this.getImageBuffer(params.imageUrl);
            const imageBase64 = imageBuffer.toString('base64');

            // 设置默认参数
            const splitCount = params.splitCount || 2;
            const splitDirection = params.splitDirection || 'horizontal';
            const splitPrompt = params.prompt || `将图片${splitDirection === 'horizontal' ? '水平' : '垂直'}拆分为${splitCount}个部分，保持每个部分的内容完整和连贯性`;

            // 计算目标尺寸（保持原图比例，适当调整大小）
            const dimensions = await this.getImageDimensions(params.imageUrl);
            let targetWidth = dimensions?.width || 1024;
            let targetHeight = dimensions?.height || 1024;

            // 根据拆分方向调整尺寸
            if (splitDirection === 'horizontal') {
                // 水平拆分：保持宽度，调整高度
                targetHeight = Math.floor(targetHeight * 1.2);
            } else {
                // 垂直拆分：保持高度，调整宽度
                targetWidth = Math.floor(targetWidth * 1.2);
            }

            const targetSize = `${targetWidth}x${targetHeight}`;
            console.log(`[DreamAPI] 使用图生图模式实现拆分，目标尺寸: ${targetSize}`);

            const url = `${BASE_URL}/api/v3/images/generations`;
            const requestBody: any = {
                model: MODEL_ID,
                prompt: splitPrompt,
                image: `data:image/png;base64,${imageBase64}`,
                n: 1,
                response_format: "url",
                size: targetSize,
                stream: false,
                watermark: false,
            };

            const response = await axiosNoProxy.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ARK_API_KEY}`
                },
                timeout: 1800000
            });

            const resData = response.data;
            if (!resData.data || resData.data.length === 0 || !resData.data[0].url) {
                throw new Error("API返回成功但未包含图片URL");
            }

            const localUrl = await this.downloadAndSaveImage(resData.data[0].url);
            console.log(`[DreamAPI] ✅ 图片拆分成功: ${localUrl}`);

            return {
                original_id: resData.created ? String(resData.created) : `dream_split_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            const errInfo = error.response?.data || error.message;
            console.error("❌ [DreamAPI Split Failed]", typeof errInfo === 'object' ? JSON.stringify(errInfo) : errInfo);
            throw new Error(`图片拆分失败: ${error.message}`);
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

        console.log(`[DreamAPI] 准备下载图片: ${imageUrl}`);

        let downloadUrl = imageUrl; // 用于下载的URL

        // 处理不同类型的URL
        if (imageUrl.startsWith('http://localhost:') || imageUrl.startsWith('http://127.0.0.1:')) {
            // 本地开发服务器的URL，先尝试转换为本地文件路径
            const urlPath = new URL(imageUrl).pathname; // 例如: /uploads/upload_xxx.jpg
            const localPath = path.join(process.cwd(), urlPath);
            console.log(`[DreamAPI] 本地服务器URL，转换为本地路径: ${localPath}`);

            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, filePath);
                console.log(`[DreamAPI] 本地文件复制成功: ${filePath}`);
                return filePath;
            } else {
                // 如果本地文件不存在，尝试将前端URL转换为后端URL
                const urlObj = new URL(imageUrl);
                const frontendPort = urlObj.port;
                const backendPort = process.env.PORT || '3000';

                // 如果是前端开发服务器（5173），转换为后端服务器（3000）
                if (frontendPort === '5173' || frontendPort === '5174') {
                    urlObj.port = backendPort;
                    downloadUrl = urlObj.toString();
                    console.log(`[DreamAPI] 前端URL转换为后端URL: ${downloadUrl}`);
                } else {
                    // 如果本地文件不存在，尝试从URL下载
                    console.log(`[DreamAPI] 本地文件不存在，尝试从URL下载...`);
                }
            }
        }

        if (imageUrl.startsWith('/uploads/') || (imageUrl.startsWith('http') && imageUrl.includes('/uploads/'))) {
            const pathPart = imageUrl.startsWith('http') ? new URL(imageUrl).pathname : imageUrl;
            try {
                const buf = await getFileContent(pathPart);
                await fs.promises.writeFile(filePath, buf);
                return filePath;
            } catch (e) {
                // 可能未启用 COS 且本地无文件，继续走下方逻辑
            }
        }
        if (imageUrl.startsWith('/uploads/')) {
            const localPath = path.join(process.cwd(), imageUrl);
            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, filePath);
                console.log(`[DreamAPI] 相对路径文件复制成功: ${filePath}`);
                return filePath;
            }
        }

        // 从网络下载（包括本地服务器URL）
        if (downloadUrl.startsWith('http')) {
            try {
                console.log(`[DreamAPI] 从网络下载图片: ${downloadUrl}`);
                    const response = await axiosNoProxy.get(downloadUrl, {
                        responseType: 'stream',
                        timeout: 1800000,
                        maxRedirects: 5,
                        validateStatus: (status) => status >= 200 && status < 400
                    });
                await pipeline(response.data, fs.createWriteStream(filePath));
                console.log(`[DreamAPI] 网络下载成功: ${filePath}`);
                return filePath;
            } catch (error: any) {
                console.error(`[DreamAPI] 网络下载失败:`, error.message);
                console.error(`[DreamAPI] 下载URL: ${downloadUrl}`);
                console.error(`[DreamAPI] 错误详情:`, error.response?.status, error.response?.statusText);
                // 如果是从前端URL转换来的，尝试直接使用原始URL
                if (downloadUrl !== imageUrl && imageUrl.startsWith('http')) {
                    console.log(`[DreamAPI] 尝试使用原始URL下载: ${imageUrl}`);
                    try {
                        const response = await axiosNoProxy.get(imageUrl, {
                            responseType: 'stream',
                            timeout: 1800000
                        });
                        await pipeline(response.data, fs.createWriteStream(filePath));
                        console.log(`[DreamAPI] 使用原始URL下载成功: ${filePath}`);
                        return filePath;
                    } catch (retryError: any) {
                        console.error(`[DreamAPI] 使用原始URL也失败:`, retryError.message);
                    }
                }
                throw new Error(`无法下载图片: ${error.message}`);
            }
        }

        // 尝试作为本地文件路径
        if (fs.existsSync(imageUrl)) {
            fs.copyFileSync(imageUrl, filePath);
            console.log(`[DreamAPI] 本地文件复制成功: ${filePath}`);
            return filePath;
        }

        throw new Error(`无法处理图片URL: ${imageUrl}`);
    }
}
