import { Request, Response, NextFunction } from "express";
import { AdminService } from "../services/admin.service";

const adminService = new AdminService();

/**
 * 检查是否为超级管理员
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const isAdmin = await adminService.isAdmin(userId);
        if (!isAdmin) {
            return res.status(403).json({ message: "需要超级管理员权限" });
        }

        next();
    } catch (error) {
        return res.status(500).json({ message: "权限检查失败" });
    }
};
