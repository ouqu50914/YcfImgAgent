import { AppDataSource } from "../data-source";
import { OperationLog } from "../entities/OperationLog";

export class LogService {
    private logRepo = AppDataSource.getRepository(OperationLog);

    /**
     * 记录操作日志
     */
    async logOperation(
        userId: number,
        operationType: string,
        options?: {
            apiType?: string;
            details?: any;
            ipAddress?: string;
            userAgent?: string;
        }
    ) {
        try {
            const log = new OperationLog();
            log.user_id = userId;
            log.operation_type = operationType;
            
            // 只在值存在时才赋值，避免 exactOptionalPropertyTypes 类型错误
            if (options?.apiType) {
                log.api_type = options.apiType;
            }
            if (options?.details) {
                log.details = JSON.stringify(options.details);
            }
            if (options?.ipAddress) {
                log.ip_address = options.ipAddress;
            }
            if (options?.userAgent) {
                log.user_agent = options.userAgent;
            }

            await this.logRepo.save(log);
        } catch (error) {
            // 日志记录失败不应该影响主流程
            console.error("记录操作日志失败:", error);
        }
    }

    /**
     * 查询操作日志
     */
    async getLogs(filters?: {
        userId?: number;
        operationType?: string;
        apiType?: string;
        startDate?: Date;
        endDate?: Date;
        page?: number;
        pageSize?: number;
    }) {
        const queryBuilder = this.logRepo.createQueryBuilder('log');

        if (filters?.userId) {
            queryBuilder.andWhere('log.user_id = :userId', { userId: filters.userId });
        }

        if (filters?.operationType) {
            queryBuilder.andWhere('log.operation_type = :operationType', { operationType: filters.operationType });
        }

        if (filters?.apiType) {
            queryBuilder.andWhere('log.api_type = :apiType', { apiType: filters.apiType });
        }

        if (filters?.startDate) {
            queryBuilder.andWhere('log.created_at >= :startDate', { startDate: filters.startDate });
        }

        if (filters?.endDate) {
            queryBuilder.andWhere('log.created_at <= :endDate', { endDate: filters.endDate });
        }

        queryBuilder.orderBy('log.created_at', 'DESC');

        const page = filters?.page || 1;
        const pageSize = filters?.pageSize || 20;
        const skip = (page - 1) * pageSize;

        queryBuilder.skip(skip).take(pageSize);

        const [logs, total] = await queryBuilder.getManyAndCount();

        return {
            logs: logs.map(log => ({
                ...log,
                details: log.details ? JSON.parse(log.details) : null
            })),
            total,
            page,
            pageSize
        };
    }
}
