import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ message: "未提供认证令牌" });
    }

    jwt.verify(token, process.env.JWT_SECRET || "default_secret", (err: any, user: any) => {
        if (err) {
            // Token 过期或无效
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    message: "Token 已过期",
                    code: "TOKEN_EXPIRED",
                    expired: true
                });
            }
            return res.status(403).json({ message: "无效的认证令牌" });
        }
        
        // 验证 token 类型
        if (user.type && user.type !== 'access') {
            return res.status(403).json({ message: "无效的 token 类型" });
        }
        
        (req as any).user = user; // 将解码后的用户信息挂载到 req 上
        next();
    });
};