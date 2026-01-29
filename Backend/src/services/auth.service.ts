import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export class AuthService {
    private userRepository = AppDataSource.getRepository(User);
    // 注册逻辑
    async register(username: string, password: string) {
        // 1. 检查用户是否已存在
        const existingUser = await this.userRepository.findOne({ where: { username } });
        if (existingUser) {
            throw new Error("用户名已存在");
        }

        // 2. 密码加密 (bcrypt)
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. 创建并保存用户
        const user = new User();
        user.username = username;
        user.password = hashedPassword;
        user.role_id = 2; // 默认为普通用户
        
        await this.userRepository.save(user);
        return { message: "注册成功", userId: user.id };
    }

    // 登录逻辑
    async login(username: string, password: string) {
        // 1. 查找用户 (显式查询 password 字段，因为 Entity 中设置了 select: false)
        const user = await this.userRepository.findOne({
            where: { username },
            select: ["id", "username", "password", "role_id", "status"] 
        });

        if (!user) {
            throw new Error("用户不存在");
        }

        if (user.status === 0) {
            throw new Error("账号已被禁用");
        }

        // 2. 验证密码
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new Error("密码错误");
        }

        // 3. 生成 JWT Token
        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role_id },
            process.env.JWT_SECRET || "default_secret",
            { expiresIn: "7d" } // 7天过期
        );

        return {
            token,
            userInfo: {
                id: user.id,
                username: user.username,
                role: user.role_id
            }
        };
    }
}