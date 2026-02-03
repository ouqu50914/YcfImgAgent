import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { LogService } from "../services/log.service";

const authService = new AuthService();
const logService = new LogService();

export const register = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: "用户名和密码不能为空" });
        }
        
        const result = await authService.register(username, password);
        return res.status(201).json(result);
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: "用户名和密码不能为空" });
        }

        const result = await authService.login(username, password);
        
        // 记录登录日志
        const ipAddressRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const logOptions: {
            ipAddress?: string;
            userAgent?: string;
        } = {};
        
        if (ipAddressRaw) {
            const ipAddress = Array.isArray(ipAddressRaw) ? ipAddressRaw[0] : ipAddressRaw;
            if (ipAddress && typeof ipAddress === 'string') {
                logOptions.ipAddress = ipAddress;
            }
        }
        if (userAgent) {
            logOptions.userAgent = userAgent;
        }
        
        await logService.logOperation(result.userInfo.id, 'login', logOptions);

        return res.status(200).json({
            message: "登录成功",
            data: result
        });
    } catch (error: any) {
        // 为了安全，通常统一返回"用户名或密码错误"，但开发阶段可返回具体错误
        return res.status(401).json({ message: error.message });
    }
};

export const changePassword = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: "原密码和新密码不能为空" });
        }

        const result = await authService.changePassword(userId, oldPassword, newPassword);
        return res.status(200).json(result);
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const refreshToken = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ message: "Refresh token 不能为空" });
        }

        const result = await authService.refreshToken(refreshToken);
        return res.status(200).json({
            message: "Token 刷新成功",
            data: result
        });
    } catch (error: any) {
        return res.status(401).json({ message: error.message });
    }
};

export const logout = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "未登录" });
        }

        const result = await authService.logout(userId);
        return res.status(200).json(result);
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};