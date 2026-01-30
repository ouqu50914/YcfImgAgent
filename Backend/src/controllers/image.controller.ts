import { Request, Response } from "express";
import { ImageService } from "../services/image.service";

const imageService = new ImageService();

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

        return res.status(200).json({
            message: "任务提交成功",
            data: result
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};