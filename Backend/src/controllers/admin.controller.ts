import { Request, Response } from "express";
import { AdminService } from "../services/admin.service";
import { ErrorLogService } from "../services/error-log.service";

const adminService = new AdminService();
const errorLogService = new ErrorLogService();

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
        const { username, role_id, status, credits } = req.body;

        const user = await adminService.updateUser(userId, { username, role_id, status, credits });
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
 * 错误事件日志（系统 / 大模型 / 客户端归一化）
 */
export const getErrorLogs = async (req: Request, res: Response) => {
    try {
        const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
        const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
        const userIdRaw = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
        const numericCodeRaw =
            req.query.numericCode !== undefined && req.query.numericCode !== ""
                ? parseInt(req.query.numericCode as string, 10)
                : undefined;

        const userId = userIdRaw !== undefined && !Number.isNaN(userIdRaw) ? userIdRaw : undefined;
        const numericCode =
            numericCodeRaw !== undefined && !Number.isNaN(numericCodeRaw) ? numericCodeRaw : undefined;

        const errorKey = typeof req.query.errorKey === "string" && req.query.errorKey.trim() ? req.query.errorKey.trim() : undefined;
        const provider = typeof req.query.provider === "string" && req.query.provider.trim() ? req.query.provider.trim() : undefined;
        const traceId = typeof req.query.traceId === "string" && req.query.traceId.trim() ? req.query.traceId.trim() : undefined;
        const from = req.query.from ? new Date(req.query.from as string) : undefined;
        const to = req.query.to ? new Date(req.query.to as string) : undefined;

        const fromOk = from && !Number.isNaN(from.getTime()) ? from : undefined;
        const toOk = to && !Number.isNaN(to.getTime()) ? to : undefined;

        const result = await errorLogService.queryPage({
            page,
            pageSize,
            ...(userId !== undefined ? { userId } : {}),
            ...(errorKey !== undefined ? { errorKey } : {}),
            ...(numericCode !== undefined ? { numericCode } : {}),
            ...(provider !== undefined ? { provider } : {}),
            ...(traceId !== undefined ? { traceId } : {}),
            ...(fromOk !== undefined ? { from: fromOk } : {}),
            ...(toOk !== undefined ? { to: toOk } : {}),
        });

        return res.status(200).json({
            message: "获取成功",
            data: {
                logs: result.list,
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
            },
        });
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
export const getPendingCreditApplicationCount = async (_req: Request, res: Response) => {
    try {
        const count = await adminService.countPendingCreditApplications();
        return res.status(200).json({ message: "获取成功", data: { count } });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getCreditApplications = async (req: Request, res: Response) => {
    try {
        const status = req.query.status as string | undefined;
        const list = await adminService.getCreditApplications(status);
        return res.status(200).json({ message: "获取成功", data: list });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const approveCreditApplication = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        if (!adminId) return res.status(401).json({ message: "未登录" });
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ message: "无效的申请ID" });
        const { amount, admin_comment } = req.body;
        await adminService.approveCreditApplication(id, adminId, amount, admin_comment);
        return res.status(200).json({ message: "已通过" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const rejectCreditApplication = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        if (!adminId) return res.status(401).json({ message: "未登录" });
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ message: "无效的申请ID" });
        const { admin_comment } = req.body;
        await adminService.rejectCreditApplication(id, adminId, admin_comment);
        return res.status(200).json({ message: "已驳回" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const updateUserCredits = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) return res.status(400).json({ message: "无效的用户ID" });
        const { credits } = req.body;
        if (typeof credits !== 'number' || credits < 0) {
            return res.status(400).json({ message: "积分必须为非负整数" });
        }
        await adminService.updateUserCredits(userId, credits);
        return res.status(200).json({ message: "更新成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const getUserStats = async (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.id as string);
        if (isNaN(userId)) {
            return res.status(400).json({ message: "无效的用户ID" });
        }
        const filters: { startDate?: string; endDate?: string; apiType?: string } = {};
        if (req.query.startDate) filters.startDate = req.query.startDate as string;
        if (req.query.endDate) filters.endDate = req.query.endDate as string;
        if (req.query.apiType) filters.apiType = req.query.apiType as string;
        const stats = await adminService.getUserStats(userId, filters);
        return res.status(200).json({ message: "获取成功", data: stats });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 获取操作手册链接
 */
export const getHelpDocUrl = async (req: Request, res: Response) => {
    try {
        const url = await adminService.getHelpDocUrl();
        return res.status(200).json({ url });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 更新操作手册链接
 */
export const updateHelpDocUrl = async (req: Request, res: Response) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ message: "文档链接不能为空" });
        }
        await adminService.setHelpDocUrl(url);
        return res.status(200).json({ message: "更新成功" });
    } catch (error: any) {
        // AdminService 内部已经做了更详细的校验，这里统一返回 400
        return res.status(400).json({ message: error.message });
    }
};
