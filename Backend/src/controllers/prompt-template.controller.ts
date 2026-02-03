import { Request, Response } from "express";
import { PromptTemplateService } from "../services/prompt-template.service";

const templateService = new PromptTemplateService();

/**
 * 创建提示词模板
 */
export const createTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const { name, content, description } = req.body;

        if (!name || !content) {
            return res.status(400).json({ message: "名称和内容不能为空" });
        }

        const template = await templateService.createTemplate(userId, name, content, description);
        return res.status(201).json({ message: "创建成功", data: template });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 获取用户的所有提示词模板
 */
export const getUserTemplates = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const templates = await templateService.getUserTemplates(userId);
        return res.status(200).json({ message: "获取成功", data: templates });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 获取单个提示词模板
 */
export const getTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const idParam = req.params.id;
        if (typeof idParam !== 'string') {
            return res.status(400).json({ message: "无效的ID" });
        }
        const id = parseInt(idParam);
        if (isNaN(id)) {
            return res.status(400).json({ message: "无效的ID" });
        }

        const template = await templateService.getTemplateById(id, userId);
        if (!template) {
            return res.status(404).json({ message: "提示词模板不存在" });
        }

        return res.status(200).json({ message: "获取成功", data: template });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 更新提示词模板
 */
export const updateTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const idParam = req.params.id;
        if (typeof idParam !== 'string') {
            return res.status(400).json({ message: "无效的ID" });
        }
        const id = parseInt(idParam);
        if (isNaN(id)) {
            return res.status(400).json({ message: "无效的ID" });
        }

        const { name, content, description } = req.body;
        const template = await templateService.updateTemplate(id, userId, { name, content, description });
        return res.status(200).json({ message: "更新成功", data: template });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 删除提示词模板
 */
export const deleteTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const idParam = req.params.id;
        if (typeof idParam !== 'string') {
            return res.status(400).json({ message: "无效的ID" });
        }
        const id = parseInt(idParam);
        if (isNaN(id)) {
            return res.status(400).json({ message: "无效的ID" });
        }

        await templateService.deleteTemplate(id, userId);
        return res.status(200).json({ message: "删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 搜索提示词模板
 */
export const searchTemplates = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const keyword = req.query.keyword as string;
        if (!keyword) {
            return res.status(400).json({ message: "搜索关键词不能为空" });
        }

        const templates = await templateService.searchTemplates(userId, keyword);
        return res.status(200).json({ message: "搜索成功", data: templates });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};
