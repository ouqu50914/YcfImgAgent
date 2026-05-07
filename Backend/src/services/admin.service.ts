import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { ApiConfig } from "../entities/ApiConfig";
import { OperationLog } from "../entities/OperationLog";
import { UserDailyQuota } from "../entities/UserDailyQuota";
import { UserCreditApplication } from "../entities/UserCreditApplication";
import { CreditUsageLog } from "../entities/CreditUsageLog";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { WorkflowCategory } from "../entities/WorkflowCategory";
import { SystemConfig } from "../entities/SystemConfig";
import { VideoTask } from "../entities/VideoTask";
import bcrypt from "bcrypt";
import redis from "../utils/redis";
import { LogService } from "./log.service";
import { CreditService } from "./credit.service";

export interface CreditUsageExportQuery {
    from: string;
    to: string;
    userId?: number;
    roleId?: number;
    provider?: string;
}

export interface CreditUsageSummaryRow {
    userId: number;
    username: string;
    model: string;
    totalCredits: number;
    recordCount: number;
    from: string;
    to: string;
}

const DEFAULT_EXPORT_MODELS = [
    "dream (dream)",
    "nano (ace)",
    "nano (anyfast)",
    "gpt-image-2 (ace)",
    "gpt-image-2 (anyfast)",
    "gemini-3.1-flash-image-preview (anyfast)",
    "gemini-3-pro-image-preview (anyfast)",
    "midjourney (midjourney)",
    "kling (kling)",
    "seedance (seedance)",
    "pixverse (pixverse)",
];

export class AdminService {
    private userRepo = AppDataSource.getRepository(User);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private logRepo = AppDataSource.getRepository(OperationLog);
    private quotaRepo = AppDataSource.getRepository(UserDailyQuota);
    private appRepo = AppDataSource.getRepository(UserCreditApplication);
    private usageLogRepo = AppDataSource.getRepository(CreditUsageLog);
    private videoTaskRepo = AppDataSource.getRepository(VideoTask);
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private categoryRepo = AppDataSource.getRepository(WorkflowCategory);
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
    /** 待处理积分申请数量（用于前端红点） */
    async countPendingCreditApplications(): Promise<number> {
        return this.appRepo.count({ where: { status: "pending" } });
    }

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
     * 同时清除登录失败计数和锁定状态，确保用户可立即使用新密码登录
     */
    async resetPassword(userId: number, newPassword: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error("用户不存在");
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await this.userRepo.save(user);

        // 清除登录失败次数和锁定状态
        if (user.username) {
            const failKey = `login_fail:${user.username}`;
            const lockKey = `login_lock:${user.username}`;
            await redis.del(failKey);
            await redis.del(lockKey);
        }
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

    async getCreditUsageSummary(viewerUserId: number, isSuperAdmin: boolean, query: CreditUsageExportQuery): Promise<CreditUsageSummaryRow[]> {
        const imageModelExpr = "LOWER(COALESCE(NULLIF(TRIM(ir.model_name), ''), ir.api_type))";
        const imagePlatformExpr = "LOWER(COALESCE(NULLIF(TRIM(ir.model_provider), ''), ir.api_type))";
        const imageModelPlatformExpr = `CONCAT(${imageModelExpr}, ' (', ${imagePlatformExpr}, ')')`;
        const videoModelExpr = "LOWER(COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(vt.request_params, '$.model'))), ''), vt.provider))";
        const videoPlatformExpr = "LOWER(COALESCE(NULLIF(TRIM(vt.provider), ''), 'video'))";
        const videoModelPlatformExpr = `CONCAT(${videoModelExpr}, ' (', ${videoPlatformExpr}, ')')`;
        const whereImageParts = ["ir.credits_spent IS NOT NULL", "ir.credits_spent > 0"];
        const whereVideoParts = ["vt.credits_spent IS NOT NULL", "vt.credits_spent > 0"];
        const imageParams: unknown[] = [query.from, query.to];
        const videoParams: unknown[] = [query.from, query.to];

        whereImageParts.push("ir.created_at >= ?");
        whereImageParts.push("ir.created_at <= ?");
        whereVideoParts.push("vt.created_at >= ?");
        whereVideoParts.push("vt.created_at <= ?");

        if (!isSuperAdmin) {
            whereImageParts.push("ir.user_id = ?");
            whereVideoParts.push("vt.user_id = ?");
            imageParams.push(viewerUserId);
            videoParams.push(viewerUserId);
        } else if (query.userId != null && query.userId > 0) {
            whereImageParts.push("ir.user_id = ?");
            whereVideoParts.push("vt.user_id = ?");
            imageParams.push(query.userId);
            videoParams.push(query.userId);
        }

        if (isSuperAdmin && (query.roleId === 1 || query.roleId === 2)) {
            whereImageParts.push("u.role_id = ?");
            whereVideoParts.push("u2.role_id = ?");
            imageParams.push(query.roleId);
            videoParams.push(query.roleId);
        }

        if (query.provider && query.provider.trim()) {
            const provider = query.provider.trim().toLowerCase();
            const providerModelLabel = `${provider} (${provider})`;
            whereImageParts.push(`(${imageModelExpr} = ? OR ${imagePlatformExpr} = ? OR ${imageModelPlatformExpr} = ?)`);
            whereVideoParts.push(`(${videoModelExpr} = ? OR ${videoPlatformExpr} = ? OR ${videoModelPlatformExpr} = ?)`);
            imageParams.push(provider, provider, providerModelLabel);
            videoParams.push(provider, provider, providerModelLabel);
        }

        const sql = `
            SELECT
                merged.user_id AS userId,
                u.username AS username,
                merged.model AS model,
                SUM(merged.credits_spent) AS totalCredits,
                COUNT(1) AS recordCount
            FROM (
                SELECT ir.user_id AS user_id, ${imageModelPlatformExpr} AS model, ir.credits_spent AS credits_spent
                FROM image_result ir
                INNER JOIN sys_user u ON u.id = ir.user_id
                WHERE ${whereImageParts.join(" AND ")}
                UNION ALL
                SELECT vt.user_id AS user_id, ${videoModelPlatformExpr} AS model, vt.credits_spent AS credits_spent
                FROM video_task vt
                INNER JOIN sys_user u2 ON u2.id = vt.user_id
                WHERE ${whereVideoParts.join(" AND ")}
            ) merged
            INNER JOIN sys_user u ON u.id = merged.user_id
            GROUP BY merged.user_id, u.username, merged.model
            ORDER BY merged.user_id ASC, totalCredits DESC
        `;

        const rows = (await AppDataSource.query(sql, [...imageParams, ...videoParams])) as any[];

        const userQb = this.userRepo
            .createQueryBuilder("user")
            .select(["user.id AS userId", "user.username AS username"]);
        if (!isSuperAdmin) {
            userQb.where("user.id = :viewerUserId", { viewerUserId });
        } else if (query.userId != null && query.userId > 0) {
            userQb.where("user.id = :queryUserId", { queryUserId: query.userId });
        }
        if (isSuperAdmin && (query.roleId === 1 || query.roleId === 2)) {
            userQb.andWhere("user.role_id = :queryRoleId", { queryRoleId: query.roleId });
        }
        userQb.orderBy("user.id", "ASC");
        const userRows = (await userQb.getRawMany()) as Array<{ userId: number | string; username: string }>;

        const allModels = await this.getExportModels(query.provider);
        const summaryMap = new Map<string, { totalCredits: number; recordCount: number }>();
        for (const row of rows) {
            const userId = Number(row.userId);
            const model = String(row.model ?? "").trim().toLowerCase();
            if (!userId || !model) continue;
            summaryMap.set(`${userId}::${model}`, {
                totalCredits: Number(row.totalCredits ?? 0),
                recordCount: Number(row.recordCount ?? 0),
            });
        }

        const finalRows: CreditUsageSummaryRow[] = [];
        for (const user of userRows) {
            const userId = Number(user.userId);
            const username = String(user.username ?? "");
            for (const model of allModels) {
                const hit = summaryMap.get(`${userId}::${model}`);
                finalRows.push({
                    userId,
                    username,
                    model,
                    totalCredits: hit?.totalCredits ?? 0,
                    recordCount: hit?.recordCount ?? 0,
                    from: query.from,
                    to: query.to,
                });
            }
        }
        return finalRows;
    }

    private async getExportModels(provider?: string): Promise<string[]> {
        const providerFilter = typeof provider === "string" ? provider.trim().toLowerCase() : "";
        if (providerFilter) return [providerFilter];

        const configTypes = await this.configRepo
            .createQueryBuilder("cfg")
            .select("cfg.api_type", "model")
            .getRawMany();
        const imageTypes = await AppDataSource.query(`
            SELECT DISTINCT CONCAT(
                LOWER(COALESCE(NULLIF(TRIM(ir.model_name), ''), ir.api_type)),
                ' (',
                LOWER(COALESCE(NULLIF(TRIM(ir.model_provider), ''), ir.api_type)),
                ')'
            ) AS model
            FROM image_result ir
            WHERE COALESCE(NULLIF(TRIM(ir.model_name), ''), ir.api_type) IS NOT NULL
              AND COALESCE(NULLIF(TRIM(ir.model_name), ''), ir.api_type) <> ''
        `);
        const videoProviders = await AppDataSource.query(`
            SELECT DISTINCT CONCAT(
                LOWER(COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(vt.request_params, '$.model'))), ''), vt.provider)),
                ' (',
                LOWER(COALESCE(NULLIF(TRIM(vt.provider), ''), 'video')),
                ')'
            ) AS model
            FROM video_task vt
            WHERE COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(vt.request_params, '$.model'))), ''), vt.provider) IS NOT NULL
              AND COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(vt.request_params, '$.model'))), ''), vt.provider) <> ''
        `);

        const ordered = [...DEFAULT_EXPORT_MODELS];
        const orderMap = new Map<string, number>();
        ordered.forEach((m, idx) => orderMap.set(m, idx));

        const modelSet = new Set<string>(ordered);
        for (const row of [...configTypes, ...imageTypes, ...videoProviders]) {
            const raw = typeof row?.model === "string" ? row.model.trim().toLowerCase() : "";
            if (!raw) continue;
            if (raw.includes("(") && raw.includes(")")) {
                modelSet.add(raw);
            } else {
                modelSet.add(`${raw} (${raw})`);
            }
        }

        return Array.from(modelSet).sort((a, b) => {
            const ai = orderMap.has(a) ? (orderMap.get(a) as number) : Number.MAX_SAFE_INTEGER;
            const bi = orderMap.has(b) ? (orderMap.get(b) as number) : Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
            return a.localeCompare(b);
        });
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
        const imageCreditsUsed = Number((await usageQb.getRawOne())?.total ?? 0);

        const videoUsageQb = this.videoTaskRepo
            .createQueryBuilder("v")
            .select("COALESCE(SUM(v.credits_spent), 0)", "total")
            .where("v.user_id = :userId", { userId })
            .andWhere("v.credits_spent IS NOT NULL")
            .andWhere("v.credits_spent > 0");
        if (apiType) videoUsageQb.andWhere("v.provider = :apiType", { apiType });
        applyDateFilter(videoUsageQb, "v");
        const videoCreditsUsed = Number((await videoUsageQb.getRawOne())?.total ?? 0);
        const totalCreditsUsed = imageCreditsUsed + videoCreditsUsed;

        // 按模型维度统计积分使用
        const usageByApiQb = this.usageLogRepo
            .createQueryBuilder('log')
            .select('log.api_type', 'apiType')
            .addSelect('SUM(log.amount)', 'total')
            .where('log.user_id = :userId', { userId })
            .groupBy('log.api_type');
        if (apiType) usageByApiQb.andWhere('log.api_type = :apiType', { apiType });
        applyDateFilter(usageByApiQb, 'log');
        const imageCreditsByApiType = await usageByApiQb.getRawMany();

        const videoByProviderQb = this.videoTaskRepo
            .createQueryBuilder("v")
            .select("v.provider", "apiType")
            .addSelect("SUM(v.credits_spent)", "total")
            .where("v.user_id = :userId", { userId })
            .andWhere("v.credits_spent IS NOT NULL")
            .andWhere("v.credits_spent > 0")
            .groupBy("v.provider");
        if (apiType) videoByProviderQb.andWhere("v.provider = :apiType", { apiType });
        applyDateFilter(videoByProviderQb, "v");
        const videoCreditsByApiType = await videoByProviderQb.getRawMany();

        const mergedCreditsByApiType = new Map<string, number>();
        for (const row of [...imageCreditsByApiType, ...videoCreditsByApiType]) {
            const key = String(row.apiType || "").trim();
            if (!key) continue;
            const value = Number(row.total ?? 0);
            mergedCreditsByApiType.set(key, (mergedCreditsByApiType.get(key) ?? 0) + value);
        }

        // 项目数（工作流模板）
        const projectQb = this.templateRepo
            .createQueryBuilder('t')
            .where('t.user_id = :userId', { userId });
        applyDateFilter(projectQb, 't');
        const projectCount = await projectQb.getCount();

        // 项目分类统计（按 workflow_template.category 分组）
        const projectCategoryQb = this.templateRepo
            .createQueryBuilder("t")
            .select("t.category", "categoryCode")
            .addSelect("COUNT(1)", "count")
            .where("t.user_id = :userId", { userId })
            .groupBy("t.category");
        applyDateFilter(projectCategoryQb, "t");
        const projectCategoryRows = await projectCategoryQb.getRawMany();

        const allCategories = await this.categoryRepo.find({
            select: ["code", "name", "sort_order"],
            order: { sort_order: "ASC" },
        });
        const countByCode = new Map<string, number>();
        let uncategorizedCount = 0;
        for (const r of projectCategoryRows) {
            const codeRaw = typeof r.categoryCode === "string" ? r.categoryCode.trim() : "";
            const count = Number(r.count ?? 0);
            if (!codeRaw) {
                uncategorizedCount += count;
                continue;
            }
            countByCode.set(codeRaw, (countByCode.get(codeRaw) ?? 0) + count);
        }

        const projectCountByCategory: Array<{ categoryCode: string; categoryName: string; count: number }> = allCategories.map((c) => ({
            categoryCode: c.code,
            categoryName: c.name,
            count: countByCode.get(c.code) ?? 0,
        }));

        // 有历史项目未设置分类时，附加“未分类”
        if (uncategorizedCount > 0) {
            projectCountByCategory.push({
                categoryCode: "__uncategorized__",
                categoryName: "未分类",
                count: uncategorizedCount,
            });
        }

        return {
            user,
            lastLoginTime: lastLogin?.created_at || null,
            totalCreditsUsed,
            projectCount,
            projectCountByCategory,
            creditsByApiType: Array.from(mergedCreditsByApiType.entries())
                .map(([type, total]) => ({
                    apiType: type,
                    total,
                }))
                .sort((a, b) => b.total - a.total),
            filters: { startDate: filters?.startDate, endDate: filters?.endDate, apiType: filters?.apiType }
        };
    }
}
