import { Request, Response } from "express";
import { ImageService } from "../services/image.service";
import { LogService } from "../services/log.service";

const imageService = new ImageService();
const logService = new LogService();

export const generateImage = async (req: Request, res: Response) => {
    try {
        // 从 JWT 中解析出的 userId (在 middleware 中赋值，稍后补充)
        const userId = (req as any).user?.userId; 
        const { apiType, prompt, width, height, style } = req.body;

        if (!prompt) {
            return res.status(400).json({ message: "提示词不能为空" });
        }

        const result = await imageService.generate(userId, apiType || 'dream', {
            prompt, width, height, style
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
        return res.status(500).json({ message: error.message });
    }
};