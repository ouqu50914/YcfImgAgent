import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";

const authService = new AuthService();

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
        return res.status(200).json({
            message: "登录成功",
            data: result
        });
    } catch (error: any) {
        // 为了安全，通常统一返回“用户名或密码错误”，但开发阶段可返回具体错误
        return res.status(401).json({ message: error.message });
    }
};