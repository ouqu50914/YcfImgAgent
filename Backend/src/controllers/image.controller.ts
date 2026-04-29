import { Request, Response } from "express";
import { ImageService } from "../services/image.service";
import { LogService } from "../services/log.service";

const imageService = new ImageService();
const logService = new LogService();

export const generateImage = async (req: Request, res: Response) => {
    try {
        // 从 JWT 中解析出的 userId (在 middleware 中赋值，稍后补充)
        const userId = (req as any).user?.userId; 
        const userRole = Number((req as any).user?.role);
        const {
            apiType,
            prompt,
            width,
            height,
            style,
            imageUrl,
            imageUrls,
            imageAliases,
            numImages,
            quality,
            model,
            providerHint,
            aspectRatio,
            generationKey,
            templateId,
            mode,
            timeout,
            translation,
            splitImages,
            mjAction,
            imageId,
            callbackUrl,
            taskId,
        } = req.body;
        const isAdmin = userRole === 1;
        const isAnyfastProRequest = model === 'gemini-3-pro-image-preview';
        const isGptImage2Request = model === 'gpt-image-2';
        const isGptImage2AnyfastRequest = isGptImage2Request && providerHint === 'anyfast';
        if (!isAdmin && isAnyfastProRequest) {
            return res.status(403).json({
                code: 'ANYFAST_PRO_FORBIDDEN',
                message: '普通用户暂不支持使用 AnyFast Nano Pro',
            });
        }
        if (!isAdmin && isGptImage2AnyfastRequest) {
            return res.status(403).json({
                code: 'GPT_IMAGE2_FORBIDDEN',
                message: '普通用户暂不支持使用 GPT Image 2(anyfast)',
            });
        }

        // 图生图时提示词可以为空，但必须有参考图片
        const hasImage = !!imageUrl || (imageUrls && imageUrls.length > 0);
        if (!prompt && !hasImage) {
            return res.status(400).json({ message: "提示词或参考图片至少需要提供一个" });
        }

        const tid = templateId != null && templateId !== '' ? Number(templateId) : undefined;
        const normalizedApiType = (apiType === 'dream' || apiType === 'nano' || apiType === 'midjourney')
            ? apiType
            : 'dream';

        const result = await imageService.generate(userId, normalizedApiType, {
            prompt: prompt || '基于参考图片生成',
            width,
            height,
            style,
            num_images: numImages || 1,
            imageUrl,
            imageUrls,
            imageAliases,
            quality,
            model, // 传递 Nano 子模型参数
            providerHint, // 传递供应商提示（超级管理员可直连 AnyFast）
            aspectRatio, // 传递比例参数（Nano 使用）
            generationKey, // 用于刷新/历史恢复后查询最终态
            mode,
            timeout,
            translation,
            splitImages,
            mjAction,
            imageId,
            callbackUrl,
            taskId,
            ...(Number.isFinite(tid) && (tid as number) > 0 ? { templateId: tid as number } : {}),
        });

        // 记录生图日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
        } = {
            apiType: normalizedApiType,
            details: {
                prompt,
                width,
                height,
                style,
                imageId: result.id,
                providerPolicy: (result as any)?.provider_policy || null,
            }
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
        const status = typeof error?.status === 'number' ? error.status : 500;
        const code = typeof error?.code === 'string' && error.code.trim() ? error.code : undefined;
        return res.status(status).json({ 
            code,
            message: error.message || '图片生成失败',
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * 按 generationKey 查询图片生成最终结果（用于刷新/历史恢复后拉取成功/失败态）
 */
export const listImageResults = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录或登录已失效" });

        const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
        const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 30;
        const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
        const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : undefined;
        const templateId = req.query.templateId ? parseInt(String(req.query.templateId), 10) : undefined;
        const status =
            req.query.status !== undefined && req.query.status !== ""
                ? parseInt(String(req.query.status), 10)
                : undefined;

        const opt: Parameters<typeof imageService.listResults>[1] = { page, pageSize };
        if (from) opt.from = from;
        if (to) opt.to = to;
        if (templateId != null && !Number.isNaN(templateId) && templateId > 0) opt.templateId = templateId;
        if (status != null && !Number.isNaN(status)) opt.status = status;

        const data = await imageService.listResults(userId, opt);

        return res.status(200).json({ message: "获取成功", data });
    } catch (error: any) {
        const status = typeof error?.status === "number" ? error.status : 500;
        return res.status(status).json({ message: error.message || "获取图片记录失败" });
    }
};

export const getImageGenerateResultByGenerationKey = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: '未登录或登录已失效' });

        const generationKey = req.query.generationKey;
        if (!generationKey || typeof generationKey !== 'string') {
            return res.status(400).json({ message: 'generationKey 参数必填' });
        }

        const data = await imageService.getGenerateResultByGenerationKey(userId, generationKey);
        if (!data) return res.status(404).json({ message: '生成结果未找到或尚未创建' });

        return res.status(200).json({ message: '获取生成结果成功', data });
    } catch (error: any) {
        console.error('[ImageController] 查询生成结果失败:', error);
        return res.status(500).json({ message: error.message || '查询生成结果失败' });
    }
};

export const upscaleImage = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { apiType, imageUrl, scale, templateId } = req.body;
        const tid = templateId != null && templateId !== '' ? Number(templateId) : undefined;

        if (!imageUrl) {
            return res.status(400).json({ message: "图片URL不能为空" });
        }

        const result = await imageService.upscale(userId, apiType || 'dream', {
            imageUrl,
            scale: scale || 2,
            ...(Number.isFinite(tid) && (tid as number) > 0 ? { templateId: tid as number } : {}),
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
        const { apiType, imageUrl, direction, width, height, ratio, prompt, templateId } = req.body;
        const tid = templateId != null && templateId !== '' ? Number(templateId) : undefined;

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
            prompt,
            ...(Number.isFinite(tid) && (tid as number) > 0 ? { templateId: tid as number } : {}),
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

export const splitImage = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { apiType, imageUrl, splitCount, splitDirection, prompt, templateId } = req.body;
        const tid = templateId != null && templateId !== '' ? Number(templateId) : undefined;

        if (!imageUrl) {
            return res.status(400).json({ message: "图片URL不能为空" });
        }

        const result = await imageService.split(userId, apiType || 'dream', {
            imageUrl,
            splitCount,
            splitDirection,
            prompt,
            ...(Number.isFinite(tid) && (tid as number) > 0 ? { templateId: tid as number } : {}),
        });

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
        } = {
            apiType: apiType || 'dream',
            details: { imageUrl, splitCount, splitDirection, prompt, imageId: result.id }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        await logService.logOperation(userId, 'split', logOptions);

        return res.status(200).json({
            message: "图片拆分成功",
            data: result
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};