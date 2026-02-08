import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { ApiConfig } from "../entities/ApiConfig";
import { OperationLog } from "../entities/OperationLog";
import { UserDailyQuota } from "../entities/UserDailyQuota";
import { UserCreditApplication } from "../entities/UserCreditApplication";
import { CreditUsageLog } from "../entities/CreditUsageLog";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { SystemConfig } from "../entities/SystemConfig";
import bcrypt from "bcrypt";
import { LogService } from "./log.service";
import { CreditService } from "./credit.service";

export class AdminService {
    private userRepo = AppDataSource.getRepository(User);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private logRepo = AppDataSource.getRepository(OperationLog);
    private quotaRepo = AppDataSource.getRepository(UserDailyQuota);
    private appRepo = AppDataSource.getRepository(UserCreditApplication);
    private usageLogRepo = AppDataSource.getRepository(CreditUsageLog);
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private systemConfigRepo = AppDataSource.getRepository(SystemConfig);
    private logService = new LogService();
    private creditService = new CreditService();

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

        // 不返回密码字段，含积分
        queryBuilder.select(['user.id', 'user.username', 'user.role_id', 'user.status', 'user.credits', 'user.created_at', 'user.updated_at']);

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
    async updateUser(userId: number, updates: { username?: string; role_id?: number; status?: number; credits?: number }) {
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

        if (updates.credits !== undefined) {
            if (updates.credits < 0) throw new Error("积分不能为负数");
            user.credits = updates.credits;
        }

        await this.userRepo.save(user);
        return user;
    }

    /**
     * 更新用户积分
     */
    async updateUserCredits(userId: number, credits: number) {
        await this.creditService.setCredits(userId, credits);
    }

    /**
     * 获取积分申请列表
     */
    async getCreditApplications(status?: string) {
        const list = await this.appRepo.find({
            where: status ? { status } : {},
            order: { created_at: 'DESC' }
        });
        const userIds = [...new Set(list.map(a => a.user_id))];
        const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) }, select: ['id', 'username'] }) : [];
        const userMap = Object.fromEntries(users.map(u => [u.id, u]));
        return list.map(a => ({
            ...a,
            username: userMap[a.user_id]?.username || '未知'
        }));
    }

    /**
     * 通过积分申请
     */
    async approveCreditApplication(id: number, adminId: number, amount?: number, adminComment?: string) {
        const app = await this.appRepo.findOne({ where: { id } });
        if (!app) throw new Error("申请不存在");
        if (app.status !== 'pending') throw new Error("申请已处理");
        const addAmount = amount ?? app.amount;
        await this.creditService.addCredits(app.user_id, addAmount);
        app.status = 'approved';
        app.admin_id = adminId;
        app.admin_comment = adminComment ?? null;
        await this.appRepo.save(app);
        return app;
    }

    /**
     * 驳回积分申请
     */
    async rejectCreditApplication(id: number, adminId: number, adminComment?: string) {
        const app = await this.appRepo.findOne({ where: { id } });
        if (!app) throw new Error("申请不存在");
        if (app.status !== 'pending') throw new Error("申请已处理");
        app.status = 'rejected';
        app.admin_id = adminId;
        app.admin_comment = adminComment ?? null;
        await this.appRepo.save(app);
        return app;
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
     * 获取操作手册链接
     */
    async getHelpDocUrl(): Promise<string | null> {
        const record = await this.systemConfigRepo.findOne({ where: { key: "help_doc_url" } });
        return record?.value ?? null;
    }

    /**
     * 设置操作手册链接
     */
    async setHelpDocUrl(url: string): Promise<void> {
        const trimmed = url.trim();
        if (!trimmed) {
            throw new Error("文档链接不能为空");
        }
        // 简单校验 URL 格式
        if (!/^https?:\/\//i.test(trimmed)) {
            throw new Error("文档链接必须以 http:// 或 https:// 开头");
        }

        let record = await this.systemConfigRepo.findOne({ where: { key: "help_doc_url" } });
        if (!record) {
            record = this.systemConfigRepo.create({
                key: "help_doc_url",
                value: trimmed,
                description: "操作手册文档链接"
            });
        } else {
            record.value = trimmed;
        }
        await this.systemConfigRepo.save(record);
    }

    /**
     * 获取用户统计信息（支持时间、模型维度筛选）
     */
    async getUserStats(
        userId: number,
        filters?: { startDate?: string; endDate?: string; apiType?: string }
    ) {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'username', 'role_id', 'status', 'credits', 'created_at', 'updated_at']
        });

        if (!user) {
            throw new Error("用户不存在");
        }

        const lastLogin = await this.logRepo.findOne({
            where: { user_id: userId, operation_type: 'login' },
            order: { created_at: 'DESC' }
        });

        const startDate = filters?.startDate ? new Date(filters.startDate) : null;
        const endDate = filters?.endDate ? new Date(filters.endDate) : null;
        const apiType = filters?.apiType || undefined;

        const applyDateFilter = (qb: any, alias: string) => {
            if (startDate) qb.andWhere(`${alias}.created_at >= :startDate`, { startDate });
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                qb.andWhere(`${alias}.created_at <= :endDate`, { endDate: end });
            }
        };

        // 总积分使用量
        const usageQb = this.usageLogRepo
            .createQueryBuilder('log')
            .select('COALESCE(SUM(log.amount), 0)', 'total')
            .where('log.user_id = :userId', { userId });
        if (apiType) usageQb.andWhere('log.api_type = :apiType', { apiType });
        applyDateFilter(usageQb, 'log');
        const totalCreditsUsed = (await usageQb.getRawOne())?.total ?? 0;

        // 按模型维度统计积分使用
        const usageByApiQb = this.usageLogRepo
            .createQueryBuilder('log')
            .select('log.api_type', 'apiType')
            .addSelect('SUM(log.amount)', 'total')
            .where('log.user_id = :userId', { userId })
            .groupBy('log.api_type');
        applyDateFilter(usageByApiQb, 'log');
        const creditsByApiType = await usageByApiQb.getRawMany();

        // 项目数（工作流模板）
        const projectQb = this.templateRepo
            .createQueryBuilder('t')
            .where('t.user_id = :userId', { userId });
        applyDateFilter(projectQb, 't');
        const projectCount = await projectQb.getCount();

        return {
            user,
            lastLoginTime: lastLogin?.created_at || null,
            totalCreditsUsed: Number(totalCreditsUsed),
            projectCount,
            creditsByApiType: creditsByApiType.map((r: any) => ({
                apiType: r.apiType,
                total: Number(r.total)
            })),
            filters: { startDate: filters?.startDate, endDate: filters?.endDate, apiType: filters?.apiType }
        };
    }
}
