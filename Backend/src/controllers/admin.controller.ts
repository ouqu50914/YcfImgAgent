import { Request, Response } from "express";
import { AdminService } from "../services/admin.service";

const adminService = new AdminService();

/**
 * 获取用户列表
 */
export const getUserList = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 20;
        const username = req.query.username as string | undefined;
        const status = req.query.status ? parseInt(req.query.status as string) : undefined;

        const filters: { username?: string; status?: number } = {};
        if (username) filters.username = username;
        if (status !== undefined) filters.status = status;

        const result = await adminService.getUserList(page, pageSize, filters);
        return res.status(200).json({ message: "获取成功", data: result });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 创建用户
 */
export const createUser = async (req: Request, res: Response) => {
    try {
        const { username, password, role_id } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: "用户名和密码不能为空" });
        }

        const user = await adminService.createUser(username, password, role_id || 2);
        return res.status(201).json({ message: "创建成功", data: user });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 更新用户
 */
export const updateUser = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) {
            return res.status(400).json({ message: "无效的用户ID" });
        }
        const { username, role_id, status } = req.body;

        const user = await adminService.updateUser(userId, { username, role_id, status });
        return res.status(200).json({ message: "更新成功", data: user });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 重置用户密码
 */
export const resetPassword = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) {
            return res.status(400).json({ message: "无效的用户ID" });
        }
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({ message: "新密码不能为空" });
        }

        await adminService.resetPassword(userId, newPassword);
        return res.status(200).json({ message: "密码重置成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 删除用户
 */
export const deleteUser = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) {
            return res.status(400).json({ message: "无效的用户ID" });
        }
        await adminService.deleteUser(userId);
        return res.status(200).json({ message: "删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 获取操作日志
 */
export const getOperationLogs = async (req: Request, res: Response) => {
    try {
        const filters: {
            userId?: number;
            operationType?: string;
            apiType?: string;
            startDate?: Date;
            endDate?: Date;
            page?: number;
            pageSize?: number;
        } = {
            page: req.query.page ? parseInt(req.query.page as string) : 1,
            pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20
        };

        if (req.query.userId) {
            filters.userId = parseInt(req.query.userId as string);
        }
        if (req.query.operationType) {
            filters.operationType = req.query.operationType as string;
        }
        if (req.query.apiType) {
            filters.apiType = req.query.apiType as string;
        }
        if (req.query.startDate) {
            filters.startDate = new Date(req.query.startDate as string);
        }
        if (req.query.endDate) {
            filters.endDate = new Date(req.query.endDate as string);
        }

        const result = await adminService.getOperationLogs(filters);
        return res.status(200).json({ message: "获取成功", data: result });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 获取API配置列表
 */
export const getApiConfigs = async (req: Request, res: Response) => {
    try {
        const configs = await adminService.getApiConfigs();
        return res.status(200).json({ message: "获取成功", data: configs });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 更新API配置
 */
export const updateApiConfig = async (req: Request, res: Response) => {
    try {
        const apiType = req.params.apiType as string;
        if (!apiType) {
            return res.status(400).json({ message: "API类型不能为空" });
        }
        const { status, user_daily_limit } = req.body;

        const config = await adminService.updateApiConfig(apiType, { status, user_daily_limit });
        return res.status(200).json({ message: "更新成功", data: config });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 获取用户统计信息
 */
export const getUserStats = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) {
            return res.status(400).json({ message: "无效的用户ID" });
        }
        const stats = await adminService.getUserStats(userId);
        return res.status(200).json({ message: "获取成功", data: stats });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};
