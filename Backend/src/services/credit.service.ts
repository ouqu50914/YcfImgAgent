import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { CreditUsageLog } from "../entities/CreditUsageLog";

export type CreditOperation = 'generate' | 'upscale' | 'extend' | 'split' | 'layer_split';

export interface CreditLogInfo {
    operationType: CreditOperation;
    apiType: 'dream' | 'nano';
}

/**
 * 积分计算与扣减服务
 * 规则：即梦2K/1K/standard=1/张，即梦4K=2/张；Nano=5/次；Dream放大/扩展/拆分/图层分离=1
 */
export class CreditService {
    private userRepo = AppDataSource.getRepository(User);
    private usageLogRepo = AppDataSource.getRepository(CreditUsageLog);

    /**
     * 计算本次操作所需积分
     */
    calcCost(
        apiType: 'dream' | 'nano',
        operation: CreditOperation,
        options?: { quality?: string; imageCount?: number }
    ): number {
        const count = options?.imageCount ?? 1;

        if (apiType === 'nano') {
            return 5 * count;
        }

        // dream
        if (operation === 'generate') {
            const quality = options?.quality || '2K';
            const perImage = quality === '4K' ? 2 : 1;
            return perImage * count;
        }

        // dream: upscale, extend, split, layer_split
        return 1;
    }

    /**
     * 获取用户可用积分
     */
    async getCredits(userId: number): Promise<number> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['credits']
        });
        return user?.credits ?? 0;
    }

    /**
     * 扣减积分，不足时抛出异常；可选记录使用日志
     */
    async deductCredits(userId: number, amount: number, logInfo?: CreditLogInfo): Promise<void> {
        if (amount <= 0) return;

        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'credits', 'role_id']
        });
        if (!user) throw new Error("用户不存在");
        if (user.role_id === 1) return; // 超级管理员不扣积分

        if (user.credits < amount) {
            throw new Error(`积分不足，当前可用 ${user.credits} 积分，需要 ${amount} 积分。请向超级管理员申请积分`);
        }

        user.credits -= amount;
        await this.userRepo.save(user);

        if (logInfo) {
            const log = new CreditUsageLog();
            log.user_id = userId;
            log.amount = amount;
            log.operation_type = logInfo.operationType;
            log.api_type = logInfo.apiType;
            await this.usageLogRepo.save(log);
        }
    }

    /**
     * 增加积分（管理员操作）
     */
    async addCredits(userId: number, amount: number): Promise<number> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'credits']
        });
        if (!user) throw new Error("用户不存在");

        user.credits = Math.max(0, user.credits + amount);
        await this.userRepo.save(user);
        return user.credits;
    }

    /**
     * 设置用户积分（管理员操作）
     */
    async setCredits(userId: number, credits: number): Promise<void> {
        if (credits < 0) throw new Error("积分不能为负数");
        await this.userRepo.update({ id: userId }, { credits });
    }

    /**
     * 检查是否为超级管理员（不扣积分）
     */
    async isAdmin(userId: number): Promise<boolean> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['role_id']
        });
        return user?.role_id === 1;
    }
}
