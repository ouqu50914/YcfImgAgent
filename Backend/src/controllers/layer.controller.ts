import { Request, Response } from "express";
import { LayerService } from "../services/layer.service";
import { LogService } from "../services/log.service";

const layerService = new LayerService();
const logService = new LogService();

export const splitLayer = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ message: "图片URL不能为空" });
        }

        const result = await layerService.splitImage(userId, imageUrl);

        // 记录操作日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const logOptions: {
            details?: any;
            ipAddress?: string;
        } = {
            details: { imageUrl, layerCount: result.layers?.length || 0 }
        };
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        
        await logService.logOperation(userId, 'layer_split', logOptions);

        return res.status(200).json({
            message: "图层拆分成功",
            data: result
        });
    } catch (error: any) {
        console.error('[LayerController] 图层拆分失败:', error);
        return res.status(500).json({ 
            message: error.message || '图层拆分失败'
        });
    }
};
