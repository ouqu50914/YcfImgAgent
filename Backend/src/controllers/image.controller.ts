import { Request, Response } from "express";
import { ImageService } from "../services/image.service";
import { LogService } from "../services/log.service";

const imageService = new ImageService();
const logService = new LogService();

export const generateImage = async (req: Request, res: Response) => {
    try {
        // 从 JWT 中解析出的 userId (在 middleware 中赋值，稍后补充)
        const userId = (req as any).user?.userId; 
        const { apiType, prompt, width, height, style, imageUrl, imageUrls, numImages, quality } = req.body;

        // 图生图时提示词可以为空，但必须有参考图片
        const hasImage = !!imageUrl || (imageUrls && imageUrls.length > 0);
        if (!prompt && !hasImage) {
            return res.status(400).json({ message: "提示词或参考图片至少需要提供一个" });
        }

        const result = await imageService.generate(userId, apiType || 'dream', {
            prompt: prompt || '基于参考图片生成',
            width,
            height,
            style,
            num_images: numImages || 1,
            imageUrl,
            imageUrls,
            quality
        });

        // 记录生图日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
        } = {
            apiType: apiType || 'dream',
            details: { prompt, width, height, style, imageId: result.id }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        await logService.logOperation(userId, 'generate', logOptions);

        return res.status(200).json({
            message: "任务提交成功",
            data: result
        });
    } catch (error: any) {
        console.error('[ImageController] 生图失败:', error);
        console.error('[ImageController] 错误堆栈:', error.stack);
        console.error('[ImageController] 请求参数:', {
            apiType: req.body.apiType,
            prompt: req.body.prompt,
            imageUrl: req.body.imageUrl,
            imageUrls: req.body.imageUrls
        });
        return res.status(500).json({ 
            message: error.message || '图片生成失败',
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

export const upscaleImage = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { apiType, imageUrl, scale } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ message: "图片URL不能为空" });
        }

        const result = await imageService.upscale(userId, apiType || 'dream', {
            imageUrl,
            scale: scale || 2
        });

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
        } = {
            apiType: apiType || 'dream',
            details: { imageUrl, scale: scale || 2, imageId: result.id }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        await logService.logOperation(userId, 'upscale', logOptions);

        return res.status(200).json({
            message: "图片放大成功",
            data: result
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const extendImage = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { apiType, imageUrl, direction, width, height, ratio, prompt } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ message: "图片URL不能为空" });
        }

        if (!direction || !['top', 'bottom', 'left', 'right', 'all'].includes(direction)) {
            return res.status(400).json({ message: "扩展方向必须是 top、bottom、left、right 或 all" });
        }

        const result = await imageService.extend(userId, apiType || 'dream', {
            imageUrl,
            direction,
            width,
            height,
            ratio,
            prompt
        });

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
        } = {
            apiType: apiType || 'dream',
            details: { imageUrl, direction, width, height, ratio, prompt, imageId: result.id }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        await logService.logOperation(userId, 'extend', logOptions);

        return res.status(200).json({
            message: "图片扩展成功",
            data: result
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};