import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import redis from "../utils/redis";

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
        // 0. 检查是否被锁定
        const lockKey = `login_lock:${username}`;
        const lockTime = await redis.get(lockKey);
        if (lockTime) {
            const remainingTime = parseInt(lockTime) - Date.now();
            if (remainingTime > 0) {
                const minutes = Math.ceil(remainingTime / 60000);
                throw new Error(`账号已被锁定，请${minutes}分钟后再试`);
            } else {
                // 锁定时间已过，清除锁定
                await redis.del(lockKey);
            }
        }

        // 1. 查找用户 (显式查询 password 字段，因为 Entity 中设置了 select: false)
        const user = await this.userRepository.findOne({
            where: { username },
            select: ["id", "username", "password", "role_id", "status", "credits"]
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
            // 记录失败次数
            const failKey = `login_fail:${username}`;
            const failCount = await redis.incr(failKey);
            
            // 设置过期时间（10分钟）
            await redis.expire(failKey, 600);
            
            // 如果失败3次，锁定10分钟
            if (failCount >= 3) {
                const lockExpireTime = Date.now() + 10 * 60 * 1000; // 10分钟后
                await redis.setex(lockKey, 600, lockExpireTime.toString());
                await redis.del(failKey); // 清除失败计数
                throw new Error("密码错误次数过多，账号已锁定10分钟");
            }
            
            throw new Error(`密码错误，还可尝试${3 - failCount}次`);
        }

        // 3. 登录成功，清除失败计数
        await redis.del(`login_fail:${username}`);
        await redis.del(lockKey);

        // 4. 生成 Access Token (短期有效，7天)
        const accessToken = jwt.sign(
            { userId: user.id, username: user.username, role: user.role_id, type: 'access' },
            process.env.JWT_SECRET || "default_secret",
            { expiresIn: "7d" }
        );

        // 5. 生成 Refresh Token (长期有效，30天)
        const refreshToken = jwt.sign(
            { userId: user.id, username: user.username, role: user.role_id, type: 'refresh' },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "default_secret",
            { expiresIn: "30d" }
        );

        // 6. 将 refresh token 存储到 Redis (用于撤销和验证)
        const refreshKey = `refresh_token:${user.id}`;
        await redis.setex(refreshKey, 30 * 24 * 60 * 60, refreshToken); // 30天过期

        return {
            token: accessToken,
            refreshToken: refreshToken,
            userInfo: {
                id: user.id,
                username: user.username,
                role: user.role_id,
                credits: user.credits ?? 0
            }
        };
    }

    /**
     * 刷新 Token
     */
    async refreshToken(refreshToken: string) {
        try {
            // 1. 验证 refresh token
            const decoded: any = jwt.verify(
                refreshToken,
                process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "default_secret"
            );

            if (decoded.type !== 'refresh') {
                throw new Error("无效的 refresh token");
            }

            // 2. 检查 refresh token 是否在 Redis 中（验证是否被撤销）
            const refreshKey = `refresh_token:${decoded.userId}`;
            const storedToken = await redis.get(refreshKey);
            
            if (!storedToken || storedToken !== refreshToken) {
                throw new Error("Refresh token 已失效或已被撤销");
            }

            // 3. 查找用户
            const user = await this.userRepository.findOne({
                where: { id: decoded.userId },
                select: ["id", "username", "role_id", "status", "credits"]
            });

            if (!user || user.status === 0) {
                throw new Error("用户不存在或已被禁用");
            }

            // 4. 生成新的 access token
            const newAccessToken = jwt.sign(
                { userId: user.id, username: user.username, role: user.role_id, type: 'access' },
                process.env.JWT_SECRET || "default_secret",
                { expiresIn: "7d" }
            );

            return {
                token: newAccessToken,
                userInfo: {
                    id: user.id,
                    username: user.username,
                    role: user.role_id,
                    credits: user.credits ?? 0
                }
            };
        } catch (error: any) {
            if (error.name === 'TokenExpiredError') {
                throw new Error("Refresh token 已过期，请重新登录");
            }
            throw new Error(`Token 刷新失败: ${error.message}`);
        }
    }

    /**
     * 获取当前用户信息（含积分）
     */
    async getMe(userId: number) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ["id", "username", "role_id", "status", "credits"]
        });
        if (!user) throw new Error("用户不存在");
        return {
            id: user.id,
            username: user.username,
            role: user.role_id,
            credits: user.credits ?? 0
        };
    }

    /**
     * 登出（撤销 refresh token）
     */
    async logout(userId: number) {
        const refreshKey = `refresh_token:${userId}`;
        await redis.del(refreshKey);
        return { message: "登出成功" };
    }

    /**
     * 修改密码（仅超级管理员可修改）
     */
    async changePassword(userId: number, oldPassword: string, newPassword: string) {
        // 0. 仅超级管理员可修改密码
        const roleUser = await this.userRepository.findOne({
            where: { id: userId },
            select: ["id", "role_id"]
        });
        if (!roleUser || roleUser.role_id !== 1) {
            throw new Error("普通用户不能修改密码");
        }

        // 1. 验证新密码复杂度
        if (newPassword.length < 6 || !/^(?=.*[A-Za-z])(?=.*\d)/.test(newPassword)) {
            throw new Error("新密码需满足6位以上且包含字母和数字");
        }

        // 2. 查找用户
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ["id", "password"]
        });

        if (!user) {
            throw new Error("用户不存在");
        }

        // 3. 验证原密码
        const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
        if (!isPasswordValid) {
            throw new Error("原密码错误");
        }

        // 4. 更新密码
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await this.userRepository.save(user);

        return { message: "密码修改成功" };
    }
}