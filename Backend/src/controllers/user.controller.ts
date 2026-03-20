import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { UserCreditApplication } from "../entities/UserCreditApplication";
import { AdminService } from "../services/admin.service";
import { notificationService } from "../services/notification.service";

const appRepo = AppDataSource.getRepository(UserCreditApplication);
const adminService = new AdminService();

/**
 * 提交积分申请
 */
export const createCreditApplication = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }
        const { amount, reason } = req.body;
        const username = (req as any).user?.username as string | undefined;
        if (!amount || typeof amount !== 'number' || amount < 1) {
            return res.status(400).json({ message: "请填写有效的申请积分数量" });
        }
        if (amount > 10000) {
            return res.status(400).json({ message: "单次申请积分不能超过10000" });
        }

        const app = new UserCreditApplication();
        app.user_id = userId;
        app.amount = Math.floor(amount);
        app.reason = reason || null;
        app.status = 'pending';
        await appRepo.save(app);

        // 通知在线的超级管理员：有新积分申请产生（字段统一为可 JSON 序列化的数字/字符串，避免 bigint 导致 stringify 抛错）
        notificationService.emitAdmin("credit_application_created", {
            id: Number(app.id),
            userId: Number(app.user_id),
            username: username ?? "未知",
            amount: app.amount,
            reason: app.reason,
            createdAt: app.created_at ? new Date(app.created_at).toISOString() : undefined
        });

        return res.status(201).json({ message: "申请已提交，请等待管理员审核", data: app });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 获取操作手册链接（任意登录用户可访问，用于导航栏手册入口）
 */
export const getHelpDocUrlForClient = async (req: Request, res: Response) => {
    try {
        const url = await adminService.getHelpDocUrl();
        return res.status(200).json({ url });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};
