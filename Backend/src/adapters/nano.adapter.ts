import { AiProvider, AiResponse, GenerateParams, UpscaleParams, ExtendParams, SplitParams } from "./ai-provider.interface";
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from "@google/genai";
import { pipeline } from 'stream/promises';
import axios from 'axios'; // 仅用于下载图片，不用于 API 调用

import { setGlobalDispatcher, ProxyAgent } from 'undici';


export class NanoAdapter implements AiProvider {
    private ai: GoogleGenAI;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY 环境变量未配置");
        }

        // 获取代理地址，通常是 http://127.0.0.1:7890 (Clash) 或 10809 (v2ray)
        // 建议在 .env 文件中配置 HTTPS_PROXY=http://127.0.0.1:7890
        const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

        if (proxyUrl) {
            try {
                // 设置全局代理调度器，让所有 fetch 请求都通过代理
                const dispatcher = new ProxyAgent(proxyUrl);
                setGlobalDispatcher(dispatcher);
                console.log(`[NanoAPI] 已配置代理: ${proxyUrl}`);
            } catch (error: any) {
                console.warn(`[NanoAPI] 代理配置失败: ${error.message}`);
            }
        } else {
            console.warn("[NanoAPI] 警告: 未配置 HTTPS_PROXY 环境变量，在中国大陆可能无法连接 Google API");
        }

        // 验证 API key 格式（Google API keys 通常以特定前缀开头）
        if (apiKey.length < 20) {
            console.warn("[NanoAPI] 警告: API key 长度异常，可能配置错误");
        }

        try {
            // 尝试初始化 GoogleGenAI 客户端
            // 注意：@google/genai 可能支持额外的配置选项，但目前只使用 apiKey
            this.ai = new GoogleGenAI({ apiKey });
            console.log("[NanoAPI] GoogleGenAI 客户端初始化成功");
        } catch (error: any) {
            console.error("[NanoAPI] 客户端初始化失败:", error.message);
            throw new Error(`GoogleGenAI 客户端初始化失败: ${error.message}`);
        }
    }

    // 辅助方法：测试网络连接
    private async testNetworkConnectivity(): Promise<boolean> {
        try {
            const https = await import('https');
            return new Promise((resolve) => {
                const req = https.request({
                    hostname: 'generativelanguage.googleapis.com',
                    port: 443,
                    path: '/',
                    method: 'HEAD',
                    timeout: 5000
                }, (res) => {
                    resolve(true);
                });

                req.on('error', (error) => {
                    console.error('[NanoAPI] 网络连接测试失败:', error.message);
                    resolve(false);
                });

                req.on('timeout', () => {
                    console.error('[NanoAPI] 网络连接测试超时');
                    req.destroy();
                    resolve(false);
                });

                req.end();
            });
        } catch (error: any) {
            console.error('[NanoAPI] 网络连接测试异常:', error.message);
            return false;
        }
    }

    // 辅助方法：提取底层错误信息
    private extractErrorDetails(error: any): any {
        const details: any = {
            message: error.message,
            name: error.name,
            stack: error.stack
        };

        // 尝试提取所有可能的错误属性
        if (error.cause) details.cause = error.cause;
        if (error.code) details.code = error.code;
        if (error.errno) details.errno = error.errno;
        if (error.syscall) details.syscall = error.syscall;
        if (error.address) details.address = error.address;
        if (error.port) details.port = error.port;
        if (error.response) details.response = error.response;
        if (error.request) details.request = error.request;

        // 尝试从 cause 中提取更多信息
        if (error.cause) {
            const cause = error.cause;
            if (cause.code) details.causeCode = cause.code;
            if (cause.errno) details.causeErrno = cause.errno;
            if (cause.syscall) details.causeSyscall = cause.syscall;
            if (cause.message) details.causeMessage = cause.message;
            if (cause.stack) details.causeStack = cause.stack;

            // 递归提取 cause 的所有属性
            try {
                const causeProps = Object.getOwnPropertyNames(cause);
                for (const prop of causeProps) {
                    if (!details[`cause_${prop}`] && typeof cause[prop] !== 'function') {
                        details[`cause_${prop}`] = cause[prop];
                    }
                }
            } catch (e) {
                // 忽略属性访问错误
            }
        }

        // 尝试从 error 对象的所有属性中提取信息（包括不可枚举的属性）
        try {
            const allProps = Object.getOwnPropertyNames(error);
            for (const prop of allProps) {
                if (!details[prop] && typeof error[prop] !== 'function') {
                    try {
                        details[prop] = error[prop];
                    } catch (e) {
                        // 忽略无法访问的属性
                    }
                }
            }

            // 也尝试获取原型链上的属性
            let proto = Object.getPrototypeOf(error);
            let depth = 0;
            while (proto && proto !== Object.prototype && depth < 3) {
                try {
                    const protoProps = Object.getOwnPropertyNames(proto);
                    for (const prop of protoProps) {
                        if (prop !== 'constructor' && !details[prop] && typeof error[prop] !== 'function') {
                            try {
                                details[`proto_${prop}`] = error[prop];
                            } catch (e) {
                                // 忽略无法访问的属性
                            }
                        }
                    }
                } catch (e) {
                    // 忽略原型链访问错误
                }
                proto = Object.getPrototypeOf(proto);
                depth++;
            }
        } catch (e) {
            // 忽略属性访问错误
        }

        // 尝试将整个错误对象序列化（可能会失败，但值得尝试）
        try {
            details.rawErrorString = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
        } catch (e) {
            details.rawErrorString = '无法序列化错误对象';
        }

        return details;
    }

    // 辅助方法：从错误中提取 retryDelay
    private extractRetryDelay(error: any): number | null {
        try {
            // 尝试从错误消息中解析 JSON
            if (error.message && typeof error.message === 'string') {
                // 检查消息是否是 JSON 字符串
                if (error.message.startsWith('{')) {
                    const errorObj = JSON.parse(error.message);
                    if (errorObj.error?.details) {
                        for (const detail of errorObj.error.details) {
                            if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
                                // retryDelay 可能是字符串格式 "37s" 或数字（秒）
                                const delayStr = detail.retryDelay || detail.retry_delay;
                                if (delayStr) {
                                    // 如果是字符串，提取数字部分
                                    const match = String(delayStr).match(/(\d+)/);
                                    if (match && match[1]) {
                                        return parseInt(match[1], 10) * 1000; // 转换为毫秒
                                    }
                                }
                            }
                        }
                    }
                }
                
                // 尝试从消息中直接提取 "retry in Xs" 格式
                const match = error.message.match(/retry in ([\d.]+)s/i);
                if (match) {
                    return parseFloat(match[1]) * 1000;
                }
            }
            
            // 尝试从 status 属性获取
            if (error.status === 429 && error.message) {
                const match = error.message.match(/retry in ([\d.]+)s/i);
                if (match) {
                    return parseFloat(match[1]) * 1000;
                }
            }
        } catch (e) {
            // 解析失败，返回 null
        }
        return null;
    }

    // 辅助方法：带重试的 API 调用
    private async callWithRetry<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        retryDelay: number = 1000
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;

                // 提取详细的错误信息
                const errorDetails = this.extractErrorDetails(error);
                
                // 检查是否是 429 配额错误
                const isQuotaError = error.status === 429 || 
                                    errorDetails.status === 429 ||
                                    (error.message && (error.message.includes('quota') || 
                                     error.message.includes('RESOURCE_EXHAUSTED') || 
                                     error.message.includes('exceeded your current quota')));

                // 检查是否是可重试的错误
                const isRetryable =
                    isQuotaError ||
                    error.message?.includes('fetch failed') ||
                    error.message?.includes('network') ||
                    error.message?.includes('timeout') ||
                    error.message?.includes('ECONNREFUSED') ||
                    error.message?.includes('ENOTFOUND') ||
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ENOTFOUND' ||
                    error.code === 'ECONNREFUSED' ||
                    errorDetails.causeCode === 'ECONNREFUSED' ||
                    errorDetails.causeCode === 'ENOTFOUND' ||
                    errorDetails.causeCode === 'ETIMEDOUT';

                if (!isRetryable || attempt === maxRetries) {
                    // 最后一次尝试或不可重试的错误，记录完整错误信息
                    console.error(`[NanoAPI] 请求最终失败 (尝试 ${attempt}/${maxRetries})，错误详情:`, JSON.stringify(errorDetails, null, 2));
                    throw error;
                }

                // 如果是配额错误，使用 API 返回的 retryDelay
                let delay = retryDelay * Math.pow(2, attempt - 1); // 默认指数退避
                
                if (isQuotaError) {
                    const apiRetryDelay = this.extractRetryDelay(error);
                    if (apiRetryDelay) {
                        delay = apiRetryDelay;
                        console.log(`[NanoAPI] ⚠️ 检测到配额限制 (429)，使用 API 建议的重试延迟: ${delay / 1000}秒`);
                    } else {
                        // 如果没有提取到，使用更长的延迟（60秒）
                        delay = 60000;
                        console.log(`[NanoAPI] ⚠️ 检测到配额限制 (429)，使用默认延迟: ${delay / 1000}秒`);
                    }
                }

                console.log(`[NanoAPI] 请求失败 (尝试 ${attempt}/${maxRetries})，${delay}ms 后重试...`, error.message);
                if (errorDetails.causeCode || errorDetails.code || error.status) {
                    console.log(`[NanoAPI] 错误代码: ${errorDetails.status || errorDetails.causeCode || errorDetails.code}`);
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // 辅助方法：计算 aspect ratio
    private calculateAspectRatio(width: number, height: number): string {
        const ratio = width / height;

        // 支持的 aspect ratios (按优先级)
        const ratios = [
            { name: '1:1', value: 1.0 },
            { name: '2:3', value: 2 / 3 },
            { name: '3:2', value: 3 / 2 },
            { name: '3:4', value: 3 / 4 },
            { name: '4:3', value: 4 / 3 },
            { name: '4:5', value: 4 / 5 },
            { name: '5:4', value: 5 / 4 },
            { name: '9:16', value: 9 / 16 },
            { name: '16:9', value: 16 / 9 },
            { name: '21:9', value: 21 / 9 }
        ];

        // 找到最接近的 ratio
        let closest = ratios[0]!;
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of ratios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.name;
    }

    // 辅助方法：从 SDK 响应中提取 base64 图片并保存
    private async extractAndSaveImageFromResponse(response: any, prefix: string = 'nano'): Promise<string> {
        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error("API响应中没有candidates");
        }

        const parts = candidates[0].content?.parts;
        if (!parts || !Array.isArray(parts)) {
            throw new Error("API响应中没有parts");
        }

        // 查找包含图片的 part
        let imageBase64: string | undefined;
        for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.data) {
                imageBase64 = part.inlineData.data;
                break;
            }
        }

        if (!imageBase64) {
            throw new Error("API响应中没有找到图片数据");
        }

        // 保存 base64 图片到本地
        const fileName = `${prefix}_${uuidv4()}.png`;
        const uploadDir = path.join(process.cwd(), 'uploads');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);

        // 将 base64 转换为 Buffer 并保存
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        await fs.promises.writeFile(filePath, imageBuffer);

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

    // 辅助方法：将图片 URL 转换为 base64
    private async imageUrlToBase64(imageUrl: string): Promise<{ mimeType: string; data: string }> {
        const imagePath = await this.downloadImageToTemp(imageUrl);
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');

        // 根据文件扩展名确定 mime type
        const ext = path.extname(imagePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        };

        return {
            mimeType: mimeTypes[ext] || 'image/png',
            data: base64
        };
    }

    // 1. 主入口方法：生图
    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始调用... Prompt: ${params.prompt}`);

        // 模型选择优先级：params.model > NANO_MODEL_NAME 环境变量 > 默认值
        const MODEL_NAME = params.model || process.env.NANO_MODEL_NAME || 'gemini-2.5-flash-image';

        // 兼容 numImages (前端) 和 num_images (后端接口定义)
        const count = params.num_images || (params as any).numImages || 1;
        console.log(`[NanoAPI] 收到请求: Prompt="${params.prompt}", 模型=${MODEL_NAME}, 数量=${count}`);

        // 如果是多图，使用并发请求
        if (count > 1) {
            console.log(`[NanoAPI] 检测到多图需求 (${count}张) -> 切换为并发模式`);
            return this.generateImagesInParallel(params, count, MODEL_NAME);
        }

        try {
            // 构建 parts 数组
            const parts: any[] = [
                { text: params.prompt || '生成图片' }
            ];

            // 处理参考图片
            const hasSingleImage = !!params.imageUrl;
            const hasMultipleImages = !!(params.imageUrls && params.imageUrls.length > 0);

            if (hasMultipleImages && params.imageUrls && params.imageUrls.length > 0) {
                // 多图生成单图：Gemini 3 Pro 支持最多 14 张参考图
                console.log(`[NanoAPI] 多图生成单图模式，共 ${params.imageUrls.length} 张参考图`);
                const maxImages = MODEL_NAME.includes('gemini-3-pro') ? 14 : 3;
                const imagesToUse = params.imageUrls.slice(0, maxImages);

                for (const url of imagesToUse) {
                    const imageData = await this.imageUrlToBase64(url);
                    parts.push({
                        inlineData: {
                            mimeType: imageData.mimeType,
                            data: imageData.data
                        }
                    });
                }
                console.log(`[NanoAPI] 已准备 ${imagesToUse.length} 张参考图`);
            } else if (hasSingleImage && params.imageUrl) {
                // 单图生成
                const imageData = await this.imageUrlToBase64(params.imageUrl);
                parts.push({
                    inlineData: {
                        mimeType: imageData.mimeType,
                        data: imageData.data
                    }
                });
            }

            // 确定 aspect ratio：优先使用直接提供的 aspectRatio，否则从 width/height 计算
            let finalAspectRatio: string;
            if (params.aspectRatio) {
                // 直接使用提供的 aspectRatio（字符串格式，如 "1:1"）
                finalAspectRatio = params.aspectRatio;
                console.log(`[NanoAPI] 使用提供的 aspectRatio: ${finalAspectRatio}`);
            } else {
                // 从 width/height 计算（向后兼容）
                const width = params.width || 1024;
                const height = params.height || 1024;
                finalAspectRatio = this.calculateAspectRatio(width, height);
                console.log(`[NanoAPI] 从 width/height 计算 aspectRatio: ${finalAspectRatio} (${width}x${height})`);
            }

            // 构建配置
            const config: any = {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                    aspectRatio: finalAspectRatio
                }
            };

            // 只有 gemini-3-pro-image-preview 支持 imageSize
            // gemini-2.5-flash-image 固定使用 1024px，不支持 imageSize 参数
            if (MODEL_NAME === 'gemini-3-pro-image-preview' && params.quality) {
                const qualityMap: Record<string, string> = {
                    '1K': '1K',
                    '2K': '2K',
                    '4K': '4K'
                };
                if (qualityMap[params.quality]) {
                    config.imageConfig.imageSize = qualityMap[params.quality];
                    console.log(`[NanoAPI] 设置 imageSize: ${qualityMap[params.quality]}`);
                }
            } else if (MODEL_NAME === 'gemini-2.5-flash-image' && params.quality) {
                console.log(`[NanoAPI] 注意: gemini-2.5-flash-image 不支持 imageSize，固定使用 1024px，忽略 quality 参数: ${params.quality}`);
            }

            console.log(`[NanoAPI] 发送请求至模型 ${MODEL_NAME}...`);
            console.log(`[NanoAPI] 请求参数:`, JSON.stringify({
                model: MODEL_NAME,
                partsCount: parts.length,
                hasImage: parts.some(p => p.inlineData),
                config: config
            }, null, 2));

            // 在发送请求前测试网络连接（仅在开发环境或首次失败时）
            if (process.env.NODE_ENV === 'development') {
                const isConnected = await this.testNetworkConnectivity();
                if (!isConnected) {
                    console.warn('[NanoAPI] 警告: 无法连接到 Google API 服务器，请求可能会失败');
                } else {
                    console.log('[NanoAPI] 网络连接测试通过');
                }
            }

            // 使用重试机制调用 API
            const response = await this.callWithRetry(async () => {
                return await this.ai.models.generateContent({
                    model: MODEL_NAME,
                    contents: parts,
                    config: config
                });
            }, 3, 1000);

            // 从响应中提取图片并保存
            const localUrl = await this.extractAndSaveImageFromResponse(response, 'nano');

            return {
                original_id: response.candidates?.[0]?.content?.parts?.[0]?.text || `nano_${Date.now()}`,
                images: [localUrl]
            };

        } catch (error: any) {
            // 提取并记录完整的错误信息以便调试
            const errorDetails = this.extractErrorDetails(error);
            console.error("❌ [NanoAPI Failed] 错误详情:", JSON.stringify(errorDetails, null, 2));

            // 检查是否是配额错误
            const isQuotaError = error.status === 429 || 
                                errorDetails.status === 429 ||
                                error.message?.includes('quota') ||
                                error.message?.includes('RESOURCE_EXHAUSTED') ||
                                error.message?.includes('exceeded your current quota');

            // 构建详细的错误消息
            let errorMessage = error.message;
            if (errorDetails.causeCode) {
                errorMessage += ` (底层错误代码: ${errorDetails.causeCode})`;
            }
            if (errorDetails.code || error.status) {
                errorMessage += ` (错误代码: ${errorDetails.code || error.status})`;
            }
            if (errorDetails.causeMessage) {
                errorMessage += ` (底层错误: ${errorDetails.causeMessage})`;
            }
            if (errorDetails.errno) {
                errorMessage += ` (系统错误号: ${errorDetails.errno})`;
            }

            // 如果是配额错误，提供特殊提示
            if (isQuotaError) {
                console.error("[NanoAPI] ⚠️ 配额限制错误 (429):");
                console.error("  1. 免费层配额已用完，需要等待或升级到付费计划");
                console.error("  2. 查看配额使用情况: https://ai.dev/rate-limit");
                console.error("  3. 了解配额限制: https://ai.google.dev/gemini-api/docs/rate-limits");
                
                // 尝试提取重试时间
                const retryDelay = this.extractRetryDelay(error);
                if (retryDelay) {
                    console.error(`  4. 建议在 ${retryDelay / 1000} 秒后重试`);
                } else {
                    console.error("  4. 建议等待 60 秒后重试");
                }
            } else if (error.message?.includes('fetch failed')) {
                // 原有的网络错误提示
                console.error("[NanoAPI] 诊断建议:");
                console.error("  1. 检查网络连接: 确保服务器可以访问 Google API 端点");
                console.error("  2. 检查 API Key: 验证 GEMINI_API_KEY 环境变量是否正确");
                console.error("  3. 检查防火墙/代理: 确保没有阻止对 Google API 的访问");
                console.error("  4. 检查 SSL/TLS: 验证 SSL 证书是否有效");
                console.error("  5. 检查 DNS: 确保可以解析 Google API 域名");
            }

            throw new Error(`Nano生图失败: ${errorMessage}`);
        }
    }

    // 2. 并发处理方法
    private async generateImagesInParallel(
        params: GenerateParams,
        count: number,
        modelName: string
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

                    const singleResult = await this.generateImage(newParams, '', '');
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

        // 模型选择：优先使用 gemini-3-pro-image-preview（支持更高分辨率）
        const MODEL_NAME = process.env.NANO_MODEL_NAME || 'gemini-3-pro-image-preview';

        try {
            // 下载原图并转换为base64
            const imageData = await this.imageUrlToBase64(params.imageUrl);

            // 计算放大后的尺寸和 imageSize
            const scale = params.scale || 2;
            let targetWidth = 1024;
            let targetHeight = 1024;
            let imageSize: string | undefined;

            // 如果使用 gemini-3-pro-image-preview，可以使用更高的分辨率
            if (MODEL_NAME === 'gemini-3-pro-image-preview') {
                if (scale === 4) {
                    imageSize = '4K';
                    targetWidth = 4096;
                    targetHeight = 4096;
                } else if (scale === 2) {
                    imageSize = '2K';
                    targetWidth = 2048;
                    targetHeight = 2048;
                } else {
                    imageSize = '1K';
                }
            } else {
                // gemini-2.5-flash-image 固定 1024px
                targetWidth = 1024;
                targetHeight = 1024;
            }

            const aspectRatio = this.calculateAspectRatio(targetWidth, targetHeight);

            console.log(`[NanoAPI] 使用图生图模式实现放大，目标尺寸: ${targetWidth}x${targetHeight}, imageSize: ${imageSize || 'N/A'}`);

            const config: any = {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                    aspectRatio: aspectRatio
                }
            };

            if (imageSize) {
                config.imageConfig.imageSize = imageSize;
            }

            const response = await this.callWithRetry(async () => {
                return await this.ai.models.generateContent({
                    model: MODEL_NAME,
                    contents: [
                        { text: "保持原图风格和内容，提高分辨率和细节，保持所有细节清晰" },
                        {
                            inlineData: {
                                mimeType: imageData.mimeType,
                                data: imageData.data
                            }
                        }
                    ],
                    config: config
                });
            }, 3, 1000);

            // 从响应中提取图片并保存
            const localUrl = await this.extractAndSaveImageFromResponse(response, 'nano');
            console.log(`[NanoAPI] ✅ 图片放大成功: ${localUrl}`);

            return {
                original_id: response.candidates?.[0]?.content?.parts?.[0]?.text || `nano_upscale_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            console.error("❌ [NanoAPI Upscale Failed]", error.message);
            throw new Error(`图片放大失败: ${error.message}`);
        }
    }

    async extendImage(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始扩展图片，方向: ${params.direction}`);

        // 模型选择：使用环境变量或默认值
        const MODEL_NAME = process.env.NANO_MODEL_NAME || 'gemini-2.5-flash-image';

        try {
            // 下载原图并转换为base64
            const imageData = await this.imageUrlToBase64(params.imageUrl);

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
                    extendPrompt = extendPrompt || "向上扩展画面，保持风格一致，无缝衔接";
                    break;
                case 'bottom':
                    targetHeight = Math.floor(targetHeight * 1.5);
                    extendPrompt = extendPrompt || "向下扩展画面，保持风格一致，无缝衔接";
                    break;
                case 'left':
                    targetWidth = Math.floor(targetWidth * 1.5);
                    extendPrompt = extendPrompt || "向左扩展画面，保持风格一致，无缝衔接";
                    break;
                case 'right':
                    targetWidth = Math.floor(targetWidth * 1.5);
                    extendPrompt = extendPrompt || "向右扩展画面，保持风格一致，无缝衔接";
                    break;
                case 'all':
                    // 全周扩展：四周都扩展，尺寸增加约1.5倍
                    targetWidth = Math.floor(targetWidth * 1.5);
                    targetHeight = Math.floor(targetHeight * 1.5);
                    extendPrompt = extendPrompt || "向四周扩展画面，保持风格一致，无缝衔接";
                    break;
            }

            const aspectRatio = this.calculateAspectRatio(targetWidth, targetHeight);

            console.log(`[NanoAPI] 使用图生图模式实现扩展，方向: ${params.direction}, 目标尺寸: ${targetWidth}x${targetHeight}`);

            const response = await this.callWithRetry(async () => {
                return await this.ai.models.generateContent({
                    model: MODEL_NAME,
                    contents: [
                        { text: extendPrompt },
                        {
                            inlineData: {
                                mimeType: imageData.mimeType,
                                data: imageData.data
                            }
                        }
                    ],
                    config: {
                        responseModalities: ["TEXT", "IMAGE"],
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    }
                });
            }, 3, 1000);

            // 从响应中提取图片并保存
            const localUrl = await this.extractAndSaveImageFromResponse(response, 'nano');
            console.log(`[NanoAPI] ✅ 图片扩展成功: ${localUrl}`);

            return {
                original_id: response.candidates?.[0]?.content?.parts?.[0]?.text || `nano_extend_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            console.error("❌ [NanoAPI Extend Failed]", error.message);
            throw new Error(`图片扩展失败: ${error.message}`);
        }
    }

    async splitImage(params: SplitParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[NanoAPI] 开始拆分图片，数量: ${params.splitCount}, 方向: ${params.splitDirection}`);

        // 模型选择：使用环境变量或默认值
        const MODEL_NAME = process.env.NANO_MODEL_NAME || 'gemini-2.5-flash-image';

        try {
            // 下载原图并转换为base64
            const imageData = await this.imageUrlToBase64(params.imageUrl);

            // 获取拆分数量，添加默认值
            const splitCount = params.splitCount || 2;
            
            // 构建拆分提示词
            let splitPrompt = params.prompt || "";
            if (!splitPrompt) {
                switch (params.splitDirection) {
                    case 'horizontal':
                        splitPrompt = `将图片水平拆分为${splitCount}个部分，保持每个部分的完整性和连贯性，确保分割边界自然`;
                        break;
                    case 'vertical':
                        splitPrompt = `将图片垂直拆分为${splitCount}个部分，保持每个部分的完整性和连贯性，确保分割边界自然`;
                        break;
                    default:
                        splitPrompt = `将图片拆分为${splitCount}个部分，保持每个部分的完整性和连贯性，确保分割边界自然`;
                }
            }

            // 计算目标尺寸和比例
            let targetWidth = 1024;
            let targetHeight = 1024;
            
            // 根据拆分方向调整尺寸
            if (params.splitDirection === 'horizontal') {
                targetHeight = Math.floor(1024 / splitCount);
            } else if (params.splitDirection === 'vertical') {
                targetWidth = Math.floor(1024 / splitCount);
            }

            const aspectRatio = this.calculateAspectRatio(targetWidth, targetHeight);

            console.log(`[NanoAPI] 使用图生图模式实现拆分，方向: ${params.splitDirection}, 数量: ${splitCount}, 目标尺寸: ${targetWidth}x${targetHeight}`);

            const response = await this.callWithRetry(async () => {
                return await this.ai.models.generateContent({
                    model: MODEL_NAME,
                    contents: [
                        { text: splitPrompt },
                        {
                            inlineData: {
                                mimeType: imageData.mimeType,
                                data: imageData.data
                            }
                        }
                    ],
                    config: {
                        responseModalities: ["TEXT", "IMAGE"],
                        imageConfig: {
                            aspectRatio: aspectRatio
                        }
                    }
                });
            }, 3, 1000);

            // 从响应中提取图片并保存
            const localUrl = await this.extractAndSaveImageFromResponse(response, 'nano');
            console.log(`[NanoAPI] ✅ 图片拆分成功: ${localUrl}`);

            return {
                original_id: response.candidates?.[0]?.content?.parts?.[0]?.text || `nano_split_${Date.now()}`,
                images: [localUrl]
            };
        } catch (error: any) {
            console.error("❌ [NanoAPI Split Failed]", error.message);
            throw new Error(`图片拆分失败: ${error.message}`);
        }
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
