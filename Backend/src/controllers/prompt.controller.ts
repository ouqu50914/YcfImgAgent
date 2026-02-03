import { Request, Response } from "express";
import { PromptService } from "../services/prompt.service";
import { LogService } from "../services/log.service";

const promptService = new PromptService();
const logService = new LogService();

/**
 * 优化提示词
 */
export const optimizePrompt = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { prompt, apiType, style } = req.body;

        if (!prompt) {
            return res.status(400).json({ message: "提示词不能为空" });
        }

        const optimizedPrompt = await promptService.optimizePrompt(prompt, {
            apiType: apiType || 'dream',
            style
        });

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            details?: any;
            ipAddress?: string;
        } = {
            details: { originalPrompt: prompt, optimizedPrompt, apiType, style }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        if (userId) {
            await logService.logOperation(userId, 'optimize', logOptions);
        }

        return res.status(200).json({
            message: "提示词优化成功",
            data: {
                original: prompt,
                optimized: optimizedPrompt
            }
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};
