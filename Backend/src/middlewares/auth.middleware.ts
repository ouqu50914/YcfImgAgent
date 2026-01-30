import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET || "default_secret", (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        (req as any).user = user; // 将解码后的用户信息挂载到 req 上
        next();
    });
};