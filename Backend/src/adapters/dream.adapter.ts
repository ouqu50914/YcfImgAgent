/**
 * DreamAdapter - Ace Data Cloud Seedream Images API
 * 使用 ACE_SEEDREAM_API_KEY（或 ACE_API_KEY）、ACE_API_URL、ACE_SEEDREAM_MODEL 环境变量（或 api_config 传入的 api_key/api_url）
 * 文档: https://platform.acedata.cloud/documents/seedream-images-integration
 */
import { AiProvider, AiResponse, GenerateParams, UpscaleParams, ExtendParams, SplitParams } from './ai-provider.interface';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from '../services/cos.service';
import { detectImageFormat } from '../utils/image-format';

const axiosNoProxy = axios.create({ proxy: false });
const ACE_REQUEST_TIMEOUT_MS = Number(process.env.ACE_SEEDREAM_TIMEOUT_MS || '1800000'); // 30 分钟
const ACE_REQUEST_BODY_MAX_BYTES = 20 * 1024 * 1024; // 20MB

export class DreamAdapter implements AiProvider {
    /**
     * Ace 对请求体大小有限制。调用上游前先本地校验，
     * 当图片数量过多或单图过大时直接给出明确提示。
     */
    private ensureRequestBodySize(body: Record<string, unknown>) {
        const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
        if (bytes > ACE_REQUEST_BODY_MAX_BYTES) {
            const err = new Error('请求主体超过 20MB，请减少上传图片数量或压缩图片大小后重试。') as Error & {
                code?: string;
                status?: number;
            };
            err.code = 'ACE_REQUEST_BODY_TOO_LARGE';
            err.status = 413;
            throw err;
        }
    }


    private getBaseUrl(apiUrl?: string): string {
        // Ace 适配器优先使用环境变量，避免数据库中 dream 的 api_url 仍是旧地址（如 api.dream-ai.com）导致请求发错域名
        const fromEnv = process.env.ACE_API_URL;
        if (fromEnv && fromEnv.trim()) return fromEnv.trim().replace(/\/$/, '');
        const fromConfig = apiUrl?.trim();
        if (fromConfig && fromConfig.includes('acedata.cloud')) return fromConfig.replace(/\/$/, '');
        return 'https://api.acedata.cloud';
    }

    private getApiKey(apiKey: string): string {
        // 优先使用 Seedream 专用 token，其次 api_config，再其次与 Nano 共用的 ACE_API_KEY
        const key = apiKey || process.env.ACE_SEEDREAM_API_KEY || process.env.ACE_API_KEY;
        if (!key) throw new Error('❌ 未配置 ACE_SEEDREAM_API_KEY / ACE_API_KEY 或 api_config 中 dream 的 api_key');
        return key;
    }

    private getModel(): string {
        return process.env.ACE_SEEDREAM_MODEL || 'doubao-seedream-4-5-251128';
    }

    /** doubao-seedream-4-5 系列：不支持 "1K" 等字符串，且要求总像素至少 3686400（约 1920x1920）；已是 WxH 时仅做最小像素校验并等比放大 */
    private normalizeSizeForModel(size: string, model: string): string {
        const is45 = model.includes('4-5');
        const minPixels45 = 3686400;
        const match = size.match(/^(\d+)\s*x\s*(\d+)$/i);
        if (match && match[1] != null && match[2] != null) {
            let w = parseInt(match[1], 10);
            let h = parseInt(match[2], 10);
            if (is45 && w * h < minPixels45) {
                const scale = Math.sqrt(minPixels45 / (w * h));
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            return `${w}x${h}`;
        }
        if (!is45) return size;
        const kMap: Record<string, string> = {
            '1K': '1920x1920',
            '2K': '2048x2048',
            '4K': '2048x2048',
        };
        return kMap[size] ?? size;
    }

    /** 调用 Ace Seedream 生成接口，返回远程图片 URL 列表 */
    private async postAceGenerate(
        body: { action: string; model: string; prompt: string; size: string; image?: string | string[]; response_format?: string; watermark?: boolean; stream?: boolean },
        apiKey: string,
        apiUrl?: string
    ): Promise<{ imageUrls: string[]; task_id?: string }> {
        const baseUrl = this.getBaseUrl(apiUrl);
        const key = this.getApiKey(apiKey);
        const url = `${baseUrl}/seedream/images`;
        const model = this.getModel();
        // 仅 doubao-seedream-4.5 / doubao-seedream-4.0 支持 stream 参数，其它模型（如 doubao-seedream-4-5-251128）传 stream 会报 400
        const streamSupported = model === 'doubao-seedream-4.5' || model === 'doubao-seedream-4.0';
        // doubao-seedream-4-5 系列不支持 "1K" 等分辨率字符串，需转为像素尺寸
        const sizeForApi = this.normalizeSizeForModel(body.size, model);
        const requestBody: Record<string, unknown> = {
            action: 'generate',
            model,
            prompt: body.prompt,
            size: sizeForApi,
            response_format: body.response_format ?? 'url',
            watermark: body.watermark ?? false,
            ...(body.image !== undefined && { image: body.image }),
        };
        if (streamSupported) {
            requestBody.stream = body.stream ?? false;
        }

        this.ensureRequestBodySize(requestBody);

        let response: any;
        try {
            response = await axiosNoProxy.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                    'Accept': 'application/json',
                },
                timeout: ACE_REQUEST_TIMEOUT_MS,
            });
        } catch (err: any) {
            const status = err.response?.status;
            const aceBody = err.response?.data;
            const aceError = aceBody?.error;
            const code = aceError?.code ?? aceBody?.code;
            const message = aceError?.message ?? aceError?.msg ?? aceBody?.message;
            const traceId = aceBody?.trace_id;
            if (status === 401) {
                throw new Error(
                    `Ace Seedream 认证失败 (401)。请检查 ACE_SEEDREAM_API_KEY 是否有效、是否已开通 Seedream 接口。` +
                    (code ? ` 错误码: ${code}` : '') +
                    (message ? ` 详情: ${message}` : '') +
                    (traceId ? ` trace_id: ${traceId}` : '')
                );
            }
            const detail = message || code || (aceBody && JSON.stringify(aceBody));
            throw new Error(`Ace Seedream 请求失败${status ? ` (${status})` : ''}: ${detail || err.message}`);
        }

        const resData = response.data;
        if (!resData || resData.success !== true) {
            const errMsg = resData?.error?.message || resData?.error?.code || JSON.stringify(resData);
            throw new Error(`Ace Seedream 返回错误: ${errMsg}`);
        }
        const list = resData.data;
        if (!Array.isArray(list) || list.length === 0) {
            throw new Error('API返回成功但未包含图片URL');
        }
        const imageUrls: string[] = list.map((item: { image_url?: string }) => item.image_url).filter((u): u is string => Boolean(u));
        if (imageUrls.length === 0) {
            throw new Error('API返回成功但未包含图片URL');
        }
        return { imageUrls, task_id: resData.task_id };
    }

    async generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        const count = params.num_images || (params as any).numImages || 1;
        console.log(`[DreamAPI] 收到请求: Prompt="${params.prompt}", 数量=${count}`);

        if (count > 1) {
            console.log(`[DreamAPI] 检测到多图需求 (${count}张) -> 切换为并发模式`);
            return this.generateImagesInParallel(params, count, apiKey, apiUrl);
        }

        const referenceImageUrl = params.imageUrl || (params.imageUrls && params.imageUrls.length > 0 ? params.imageUrls[0] : undefined);
        const sizeString = await this.getSizeString(params.width, params.height, params.quality, referenceImageUrl, params.aspectRatio);
        const useQualityMode = params.quality && (params.quality === '1K' || params.quality === '2K' || params.quality === '4K');
        const modeInfo = useQualityMode
            ? `方式1（分辨率模式）: ${params.quality}`
            : `方式2（像素模式）: ${sizeString}`;
        console.log(`[DreamAPI] 尺寸配置: ${modeInfo}`);

        let imageInput: string | string[] | undefined;
        const hasSingleImage = !!params.imageUrl;
        const hasMultipleImages = !!(params.imageUrls && params.imageUrls.length > 0);

        if (hasMultipleImages && params.imageUrls && params.imageUrls.length > 0) {
            console.log(`[DreamAPI] 多图生成单图模式，共 ${params.imageUrls.length} 张参考图`);
            const imagePromises = params.imageUrls.map(async (url) => {
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    const urlObj = new URL(url);
                    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                        const imageBuffer = await this.getImageBuffer(url);
                        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
                    }
                    return url;
                }
                const imageBuffer = await this.getImageBuffer(url);
                return `data:image/png;base64,${imageBuffer.toString('base64')}`;
            });
            imageInput = await Promise.all(imagePromises);
        } else if (hasSingleImage && params.imageUrl) {
            const imageBuffer = await this.getImageBuffer(params.imageUrl);
            imageInput = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        }

        try {
            console.log(`[DreamAPI] 发送单图API请求...`);
            const body: Parameters<DreamAdapter['postAceGenerate']>[0] = {
                action: 'generate',
                model: this.getModel(),
                // 根据提示词中的 @图X 与参考图片数量，构造带别名说明的 prompt
                prompt: this.buildPromptWithAliases(
                    (params.prompt || '生成图片') as string,
                    hasMultipleImages && params.imageUrls ? params.imageUrls.length : hasSingleImage ? 1 : 0
                ),
                size: sizeString,
                response_format: 'url',
                watermark: false,
                stream: false,
            };
            if (imageInput !== undefined) body.image = imageInput;
            const { imageUrls } = await this.postAceGenerate(body, apiKey, apiUrl);
            const remoteUrl = imageUrls[0];
            if (!remoteUrl) throw new Error('API返回成功但未包含图片URL');
            const localUrl = await this.downloadAndSaveImage(remoteUrl);
            console.log(`[DreamAPI] 单图生成完毕: ${localUrl}`);
            return {
                original_id: uuidv4(),
                images: [localUrl],
            };
        } catch (error: any) {
            console.error('❌ [DreamAPI Single Failed]', error.message);
            throw error;
        }
    }

    /**
     * 将用户的 prompt 与图片数量结合，生成包含别名说明的提示词。
     * 例如：图1 对应第 1 张图片；图2 对应第 2 张图片……
     * 这样 Seedream 在看到 @图1/@图2 时，就能知道对应的是哪一张参考图。
     */
    private buildPromptWithAliases(originalPrompt: string, imageCount: number): string {
        const base = originalPrompt || '生成图片';
        if (!imageCount || imageCount <= 0) return base;

        const used = new Set<number>();
        const regex = /@图(\d+)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(base)) !== null) {
            const raw = match[1];
            if (!raw) continue;
            const n = parseInt(raw, 10);
            if (Number.isNaN(n)) continue;
            if (n < 1 || n > imageCount) continue;
            used.add(n);
        }

        if (used.size === 0) {
            for (let i = 1; i <= imageCount; i++) {
                used.add(i);
            }
        }

        const aliasDesc = Array.from(used)
            .sort((a, b) => a - b)
            .map((n) => `图${n} 对应第 ${n} 张图片`)
            .join('；');

        return `有多张参考图片：${aliasDesc}。下面是用户的详细描述：${base}`;
    }

    private async generateImagesInParallel(
        params: GenerateParams,
        count: number,
        apiKey: string,
        apiUrl: string
    ): Promise<AiResponse> {
        const actualCount = Math.min(count, 4);
        console.log(`[DreamAPI] 启动并发任务: ${actualCount} 个线程`);
        const failureMessages: string[] = [];
        const tasks = Array(actualCount)
            .fill(0)
            .map(async () => {
                try {
                    const newParams = { ...params, num_images: 1, numImages: 1 };
                    const singleResult = await this.generateImage(newParams, apiKey, apiUrl);
                    if (!singleResult.images || singleResult.images.length === 0) throw new Error('生成结果中没有图片');
                    return singleResult.images[0];
                } catch (e: any) {
                    const msg = typeof e?.message === 'string' && e.message.trim()
                        ? e.message.trim()
                        : '未知错误';
                    failureMessages.push(msg);
                    console.error(`[DreamAPI] 子任务失败:`, msg);
                    return null;
                }
            });
        const results = await Promise.all(tasks);
        const successUrls = results.filter((url): url is string => !!url);
        if (successUrls.length === 0) throw new Error('并发生成全部失败');
        const failedCount = actualCount - successUrls.length;
        // 输出结构化汇总，便于对照前端占位节点状态
        console.log(`[DreamAPI] 并发汇总`, {
            requestedCount: actualCount,
            successCount: successUrls.length,
            failedCount,
            failedMessages: failureMessages.slice(0, 5),
        });
        return { original_id: uuidv4(), images: successUrls };
    }

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

    private async getImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
        try {
            // @ts-expect-error sharp 为可选依赖，可能未安装
            const sharpModule = await import('sharp').catch(() => null);
            if (!sharpModule?.default) return null;
            const sharp = sharpModule.default;
            let imageBuffer: Buffer;
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                const response = await axiosNoProxy.get(imageUrl, { responseType: 'arraybuffer' });
                imageBuffer = Buffer.from(response.data);
            } else {
                const pathPart = imageUrl.startsWith('http') ? new URL(imageUrl).pathname : imageUrl;
                if (pathPart.includes('/uploads/')) {
                    imageBuffer = await getFileContent(pathPart);
                } else {
                    const filePath = imageUrl.startsWith('/') ? path.join(process.cwd(), imageUrl) : path.join(process.cwd(), 'uploads', imageUrl);
                    if (!fs.existsSync(filePath)) return null;
                    imageBuffer = await fs.promises.readFile(filePath);
                }
            }
            const metadata = await sharp(imageBuffer).metadata();
            if (metadata.width && metadata.height) {
                return { width: metadata.width, height: metadata.height };
            }
            return null;
        } catch {
            return null;
        }
    }

    /** 将 aspectRatio 字符串转为宽高比数值，如 "16:9" -> 16/9 */
    private parseAspectRatio(ratio?: string): number | null {
        if (!ratio || ratio === 'auto') return null;
        const parts = ratio.trim().split(/\s*:\s*/);
        if (parts.length !== 2 || parts[0] == null || parts[1] == null) return null;
        const w = parseFloat(parts[0]);
        const h = parseFloat(parts[1]);
        if (!(w > 0 && h > 0)) return null;
        return w / h;
    }

    /** 按分辨率档位（1K/2K/4K）与宽高比计算目标像素数；4-5 模型最小 3686400 */
    private targetPixelsForQuality(quality: string): number {
        const min45 = 3686400;
        const map: Record<string, number> = {
            '1K': min45,
            '2K': 4194304,
            '4K': 8388608,
        };
        return map[quality] ?? min45;
    }

    private async getSizeString(
        width?: number,
        height?: number,
        quality?: string,
        imageUrl?: string,
        aspectRatio?: string
    ): Promise<string> {
        const hasQuality = quality && (quality === '1K' || quality === '2K' || quality === '4K');
        const ratioValue = this.parseAspectRatio(aspectRatio);
        const hasExplicitRatio = (width && height) || ratioValue !== null;

        if (hasQuality && hasExplicitRatio) {
            let w = width ?? 0;
            let h = height ?? 0;
            if (w && h) {
                // 已有宽高，按档位缩放至目标像素并保持比例
                const target = this.targetPixelsForQuality(quality!);
                const current = w * h;
                const scale = Math.sqrt(target / current);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
                return `${w}x${h}`;
            }
            if (ratioValue !== null && ratioValue > 0) {
                const target = this.targetPixelsForQuality(quality!);
                w = Math.round(Math.sqrt(target * ratioValue));
                h = Math.round(Math.sqrt(target / ratioValue));
                if (w > 0 && h > 0) return `${w}x${h}`;
            }
        }
        if (hasQuality) return quality!;

        if ((!width || !height) && imageUrl) {
            const dimensions = await this.getImageDimensions(imageUrl);
            if (dimensions) {
                width = dimensions.width;
                height = dimensions.height;
            }
        }
        if (!width || !height) return '2048x2048';
        let totalPixels = width * height;
        const minPixels = 921600;
        const maxPixels = 16777216;
        const aspectRatioNum = width / height;
        const minAR = 1 / 16;
        const maxAR = 16;
        if (totalPixels < minPixels) {
            const scale = Math.sqrt(minPixels / totalPixels);
            width = Math.ceil(width * scale);
            height = Math.ceil(height * scale);
        }
        totalPixels = width! * height!;
        if (totalPixels > maxPixels) {
            const scale = Math.sqrt(maxPixels / totalPixels);
            width = Math.floor(width! * scale);
            height = Math.floor(height! * scale);
        }
        const finalAR = width! / height!;
        if (finalAR < minAR || finalAR > maxAR) {
            width = 2048;
            height = 2048;
        }
        return `${width}x${height}`;
    }

    private async downloadAndSaveImage(remoteUrl: string): Promise<string> {
        const response = await axiosNoProxy.get(remoteUrl, { responseType: 'arraybuffer' });
        let buffer = Buffer.from(response.data);
        const originalContentType = (response.headers as any)?.['content-type'];
        if (process.env.ENABLE_WATERMARK === 'true') {
            try {
                buffer = await this.addWatermarkToBuffer(buffer);
            } catch (e: any) {
                console.warn('[DreamAPI] 添加水印失败，继续使用原图:', e.message);
            }
        }
        // 若加了水印，输出格式可能变化；此时更信任 buffer 魔数而不是上游 Content-Type
        const pathname = (() => {
            try { return new URL(remoteUrl).pathname; } catch { return undefined; }
        })();
        const detectParams: { firstBytes: Buffer; contentTypeHeader?: string; urlPathname?: string } = {
            firstBytes: buffer.subarray(0, 32),
        };
        if (process.env.ENABLE_WATERMARK !== 'true' && typeof originalContentType === 'string' && originalContentType.trim()) {
            detectParams.contentTypeHeader = originalContentType;
        }
        if (typeof pathname === 'string' && pathname) detectParams.urlPathname = pathname;
        const detected = detectImageFormat(detectParams);
        const fileName = `dream_${uuidv4()}${detected.ext}`;
        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, detected.mime);
            return `/uploads/${fileName}`;
        }
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }

    private async addWatermarkToBuffer(imageBuffer: Buffer): Promise<Buffer> {
        try {
            const sharpMod = await Promise.resolve().then(() => require('sharp')).catch(() => null);
            if (!sharpMod) return imageBuffer;
            const sharp = sharpMod;
            const watermarkText = process.env.WATERMARK_TEXT || '内部AI生图工具';
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            const w = metadata.width || 1024;
            const h = metadata.height || 1024;
            const fontSize = Math.max(24, Math.floor(w / 40));
            const svg = `<svg width="${w}" height="${h}"><text x="${w - 20}" y="${h - 20}" font-family="Arial" font-size="${fontSize}" fill="rgba(255,255,255,0.7)" text-anchor="end" stroke="rgba(0,0,0,0.5)" stroke-width="1">${watermarkText}</text></svg>`;
            return await image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
        } catch {
            return imageBuffer;
        }
    }

    async upscaleImage(params: UpscaleParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始放大图片，倍数: ${params.scale || 2}`);
        const imageBuffer = await this.getImageBuffer(params.imageUrl);
        const imageBase64 = imageBuffer.toString('base64');
        const scale = params.scale || 2;
        const targetSize = scale === 4 ? '2048x2048' : '1536x1536';
        try {
            const { imageUrls } = await this.postAceGenerate(
                {
                    action: 'generate',
                    model: this.getModel(),
                    prompt: '保持原图风格和内容，提高分辨率和细节',
                    size: targetSize,
                    image: `data:image/png;base64,${imageBase64}`,
                    response_format: 'url',
                    watermark: false,
                    stream: false,
                },
                apiKey,
                apiUrl
            );
            const firstUrl = imageUrls[0];
            if (!firstUrl) throw new Error('API返回成功但未包含图片URL');
            const localUrl = await this.downloadAndSaveImage(firstUrl);
            console.log(`[DreamAPI] ✅ 图片放大成功: ${localUrl}`);
            return { original_id: `dream_upscale_${Date.now()}`, images: [localUrl] };
        } catch (error: any) {
            console.error('❌ [DreamAPI Upscale Failed]', error.message);
            throw new Error(`图片放大失败: ${error.message}`);
        }
    }

    async extendImage(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始扩展图片，方向: ${params.direction}`);
        const imageBuffer = await this.getImageBuffer(params.imageUrl);
        const imageBase64 = imageBuffer.toString('base64');
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
                '21:9': { width: 2560, height: 1080 },
            };
            const r = ratioMap[params.ratio];
            if (r) {
                calculatedWidth = r.width;
                calculatedHeight = r.height;
            }
        }
        let targetSize: string;
        let extendPrompt: string;
        switch (params.direction) {
            case 'top':
                targetSize = `${calculatedWidth}x${Math.floor(calculatedHeight * 1.5)}`;
                extendPrompt = params.prompt || '向上扩展画面，保持风格一致';
                break;
            case 'bottom':
                targetSize = `${calculatedWidth}x${Math.floor(calculatedHeight * 1.5)}`;
                extendPrompt = params.prompt || '向下扩展画面，保持风格一致';
                break;
            case 'left':
                targetSize = `${Math.floor(calculatedWidth * 1.5)}x${calculatedHeight}`;
                extendPrompt = params.prompt || '向左扩展画面，保持风格一致';
                break;
            case 'right':
                targetSize = `${Math.floor(calculatedWidth * 1.5)}x${calculatedHeight}`;
                extendPrompt = params.prompt || '向右扩展画面，保持风格一致';
                break;
            case 'all':
                targetSize = `${Math.floor(calculatedWidth * 1.5)}x${Math.floor(calculatedHeight * 1.5)}`;
                extendPrompt = params.prompt || '向四周扩展画面，保持风格一致，无缝衔接';
                break;
            default:
                targetSize = '1024x1024';
                extendPrompt = params.prompt || '扩展画面，保持风格一致';
        }
        try {
            const { imageUrls } = await this.postAceGenerate(
                {
                    action: 'generate',
                    model: this.getModel(),
                    prompt: extendPrompt,
                    size: targetSize,
                    image: `data:image/png;base64,${imageBase64}`,
                    response_format: 'url',
                    watermark: false,
                    stream: false,
                },
                apiKey,
                apiUrl
            );
            const firstUrl = imageUrls[0];
            if (!firstUrl) throw new Error('API返回成功但未包含图片URL');
            const localUrl = await this.downloadAndSaveImage(firstUrl);
            console.log(`[DreamAPI] ✅ 图片扩展成功: ${localUrl}`);
            return { original_id: `dream_extend_${Date.now()}`, images: [localUrl] };
        } catch (error: any) {
            console.error('❌ [DreamAPI Extend Failed]', error.message);
            throw new Error(`图片扩展失败: ${error.message}`);
        }
    }

    async splitImage(params: SplitParams, apiKey: string, apiUrl: string): Promise<AiResponse> {
        console.log(`[DreamAPI] 开始拆分图片，数量: ${params.splitCount || 2}, 方向: ${params.splitDirection || 'horizontal'}`);
        const imageBuffer = await this.getImageBuffer(params.imageUrl);
        const imageBase64 = imageBuffer.toString('base64');
        const splitDirection = params.splitDirection || 'horizontal';
        const splitCount = params.splitCount || 2;
        const splitPrompt = params.prompt || `将图片${splitDirection === 'horizontal' ? '水平' : '垂直'}拆分为${splitCount}个部分，保持每个部分的内容完整和连贯性`;
        const dimensions = await this.getImageDimensions(params.imageUrl);
        let targetWidth = dimensions?.width || 1024;
        let targetHeight = dimensions?.height || 1024;
        if (splitDirection === 'horizontal') {
            targetHeight = Math.floor(targetHeight * 1.2);
        } else {
            targetWidth = Math.floor(targetWidth * 1.2);
        }
        const targetSize = `${targetWidth}x${targetHeight}`;
        try {
            const { imageUrls } = await this.postAceGenerate(
                {
                    action: 'generate',
                    model: this.getModel(),
                    prompt: splitPrompt,
                    size: targetSize,
                    image: `data:image/png;base64,${imageBase64}`,
                    response_format: 'url',
                    watermark: false,
                    stream: false,
                },
                apiKey,
                apiUrl
            );
            const firstUrl = imageUrls[0];
            if (!firstUrl) throw new Error('API返回成功但未包含图片URL');
            const localUrl = await this.downloadAndSaveImage(firstUrl);
            console.log(`[DreamAPI] ✅ 图片拆分成功: ${localUrl}`);
            return { original_id: `dream_split_${Date.now()}`, images: [localUrl] };
        } catch (error: any) {
            console.error('❌ [DreamAPI Split Failed]', error.message);
            throw new Error(`图片拆分失败: ${error.message}`);
        }
    }
}
