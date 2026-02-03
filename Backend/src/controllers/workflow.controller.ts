import { Request, Response } from "express";
import { WorkflowService } from "../services/workflow.service";
import { WorkflowHistoryService } from "../services/workflow-history.service";

const workflowService = new WorkflowService();
const historyService = new WorkflowHistoryService();

export const saveTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { name, workflowData, description, isPublic, coverImage } = req.body;

        if (!name || !workflowData) {
            return res.status(400).json({ message: "模板名称和工作流数据不能为空" });
        }

        const template = await workflowService.saveTemplate(
            userId,
            name,
            workflowData,
            description,
            isPublic || false,
            coverImage
        );

        return res.status(200).json({
            message: "模板保存成功",
            data: template
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getTemplates = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const templates = await workflowService.getUserTemplates(userId, true);

        return res.status(200).json({
            message: "获取成功",
            data: templates
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的模板ID" });
        }
        const templateId = parseInt(idParam);

        const template = await workflowService.getTemplate(templateId, userId);

        return res.status(200).json({
            message: "获取成功",
            data: template
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const deleteTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的模板ID" });
        }
        const templateId = parseInt(idParam);

        await workflowService.deleteTemplate(templateId, userId);

        return res.status(200).json({ message: "模板删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const updateTemplate = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的模板ID" });
        }
        const templateId = parseInt(idParam);
        const { name, description, workflowData, isPublic } = req.body;

        const template = await workflowService.updateTemplate(templateId, userId, {
            name,
            description,
            workflow_data: workflowData,
            is_public: isPublic
        });

        return res.status(200).json({
            message: "模板更新成功",
            data: template
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

// 工作流历史相关接口
export const autoSaveHistory = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { workflowData } = req.body;

        if (!workflowData) {
            return res.status(400).json({ message: "工作流数据不能为空" });
        }

        const history = await historyService.autoSave(userId, workflowData);

        return res.status(200).json({
            message: "自动保存成功",
            data: history
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getHistoryList = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const limit = parseInt(req.query.limit as string) || 20;

        const histories = await historyService.getHistoryList(userId, limit);

        return res.status(200).json({
            message: "获取成功",
            data: histories
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getHistory = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的历史记录ID" });
        }
        const historyId = parseInt(idParam);

        const history = await historyService.getHistory(historyId, userId);

        return res.status(200).json({
            message: "获取成功",
            data: history
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const deleteHistory = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的历史记录ID" });
        }
        const historyId = parseInt(idParam);

        await historyService.deleteHistory(historyId, userId);

        return res.status(200).json({ message: "历史记录删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

// 获取公开工作流模板列表（工作流广场）
export const getPublicTemplates = async (req: Request, res: Response) => {
    try {
        const keywordParam = req.query.keyword as string | undefined;
        const sortBy = (req.query.sortBy as 'time' | 'usage') || 'time';
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 12;

        const params: {
            keyword?: string;
            sortBy?: 'time' | 'usage';
            page?: number;
            pageSize?: number;
        } = {
            sortBy,
            page,
            pageSize
        };

        if (keywordParam !== undefined) {
            params.keyword = keywordParam;
        }

        const result = await workflowService.getPublicTemplates(params);

        return res.status(200).json({
            message: "获取成功",
            data: result
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};
