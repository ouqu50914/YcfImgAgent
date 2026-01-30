import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { ApiConfig } from "../entities/ApiConfig";
import { OperationLog } from "../entities/OperationLog";
import { UserDailyQuota } from "../entities/UserDailyQuota";
import bcrypt from "bcrypt";
import { LogService } from "./log.service";

export class AdminService {
    private userRepo = AppDataSource.getRepository(User);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private logRepo = AppDataSource.getRepository(OperationLog);
    private quotaRepo = AppDataSource.getRepository(UserDailyQuota);
    private logService = new LogService();

    /**
     * 检查是否为超级管理员
     */
    async isAdmin(userId: number): Promise<boolean> {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        return user?.role_id === 1;
    }

    /**
     * 获取用户列表
     */
    async getUserList(page: number = 1, pageSize: number = 20, filters?: { username?: string; status?: number }) {
        const queryBuilder = this.userRepo.createQueryBuilder('user');

        if (filters?.username) {
            queryBuilder.andWhere('user.username LIKE :username', { username: `%${filters.username}%` });
        }

        if (filters?.status !== undefined) {
            queryBuilder.andWhere('user.status = :status', { status: filters.status });
        }

        queryBuilder.orderBy('user.created_at', 'DESC');

        const skip = (page - 1) * pageSize;
        queryBuilder.skip(skip).take(pageSize);

        // 不返回密码字段
        queryBuilder.select(['user.id', 'user.username', 'user.role_id', 'user.status', 'user.created_at', 'user.updated_at']);

        const [users, total] = await queryBuilder.getManyAndCount();

        return { users, total, page, pageSize };
    }

    /**
     * 创建用户
     */
    async createUser(username: string, password: string, roleId: number = 2) {
        const existingUser = await this.userRepo.findOne({ where: { username } });
        if (existingUser) {
            throw new Error("用户名已存在");
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User();
        user.username = username;
        user.password = hashedPassword;
        user.role_id = roleId;
        user.status = 1;

        await this.userRepo.save(user);
        return user;
    }

    /**
     * 更新用户
     */
    async updateUser(userId: number, updates: { username?: string; role_id?: number; status?: number }) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error("用户不存在");
        }

        if (updates.username) {
            const existingUser = await this.userRepo.findOne({ where: { username: updates.username } });
            if (existingUser && existingUser.id !== userId) {
                throw new Error("用户名已存在");
            }
            user.username = updates.username;
        }

        if (updates.role_id !== undefined) {
            user.role_id = updates.role_id;
        }

        if (updates.status !== undefined) {
            user.status = updates.status;
        }

        await this.userRepo.save(user);
        return user;
    }

    /**
     * 重置用户密码
     */
    async resetPassword(userId: number, newPassword: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error("用户不存在");
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await this.userRepo.save(user);
    }

    /**
     * 删除用户
     */
    async deleteUser(userId: number) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error("用户不存在");
        }

        // 不能删除自己
        // 这里需要从请求中获取当前用户ID，暂时跳过检查

        await this.userRepo.remove(user);
    }

    /**
     * 获取操作日志
     */
    async getOperationLogs(filters?: {
        userId?: number;
        operationType?: string;
        apiType?: string;
        startDate?: Date;
        endDate?: Date;
        page?: number;
        pageSize?: number;
    }) {
        return await this.logService.getLogs(filters);
    }

    /**
     * 获取API配置列表
     */
    async getApiConfigs() {
        const configs = await this.configRepo.find({
            select: ['id', 'api_type', 'api_url', 'status', 'user_daily_limit', 'used_quota', 'last_sync_time']
        });
        return configs;
    }

    /**
     * 更新API配置
     */
    async updateApiConfig(apiType: string, updates: { status?: number; user_daily_limit?: number }) {
        const config = await this.configRepo.findOne({ where: { api_type: apiType } });
        if (!config) {
            throw new Error("API配置不存在");
        }

        if (updates.status !== undefined) {
            config.status = updates.status;
        }

        if (updates.user_daily_limit !== undefined) {
            config.user_daily_limit = updates.user_daily_limit;
        }

        await this.configRepo.save(config);
        return config;
    }

    /**
     * 获取用户统计信息
     */
    async getUserStats(userId: number) {
        // 获取用户基本信息
        const user = await this.userRepo.findOne({ 
            where: { id: userId },
            select: ['id', 'username', 'role_id', 'status', 'created_at', 'updated_at']
        });

        if (!user) {
            throw new Error("用户不存在");
        }

        // 获取最后登录时间（从日志中查找）
        const lastLogin = await this.logRepo.findOne({
            where: { user_id: userId, operation_type: 'login' },
            order: { created_at: 'DESC' }
        });

        // 获取操作次数统计
        const operationCounts = await this.logRepo
            .createQueryBuilder('log')
            .select('log.operation_type', 'operationType')
            .addSelect('COUNT(*)', 'count')
            .where('log.user_id = :userId', { userId })
            .groupBy('log.operation_type')
            .getRawMany();

        // 获取今日额度使用情况
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const quotas = await this.quotaRepo.find({
            where: { user_id: userId, date: today }
        });

        return {
            user,
            lastLoginTime: lastLogin?.created_at || null,
            operationCounts,
            todayQuotas: quotas
        };
    }
}
