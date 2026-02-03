import { Request, Response, NextFunction } from "express";
import redis from "../utils/redis";

/**
 * 基于Redis的限流中间件
 * 按API类型分别限流
 */
export const rateLimit = (options: {
    windowMs: number; // 时间窗口（毫秒）
    max: number; // 最大请求数
    apiType?: string; // API类型（dream/nano），用于区分限流
}) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const userId = (req as any).user?.userId;
        const apiType = options.apiType || req.body?.apiType || 'default';

        // 如果没有用户ID，跳过限流（应该由auth中间件处理）
        if (!userId) {
            return next();
        }

        const key = `rate_limit:${apiType}:${userId}`;
        const windowMs = options.windowMs;
        const max = options.max;

        try {
            // 获取当前计数
            const current = await redis.get(key);
            const count = current ? parseInt(current) : 0;

            if (count >= max) {
                const ttl = await redis.ttl(key);
                const waitSeconds = ttl > 0 ? ttl : Math.ceil(windowMs / 1000);
                return res.status(429).json({
                    message: `请求过于频繁，请${waitSeconds}秒后再试`,
                    retryAfter: waitSeconds
                });
            }

            // 增加计数
            if (count === 0) {
                // 第一次请求，设置过期时间
                await redis.setex(key, Math.ceil(windowMs / 1000), '1');
            } else {
                await redis.incr(key);
            }

            next();
        } catch (error: any) {
            console.error('[RateLimit] Redis错误:', error);
            // Redis错误时，允许请求通过（降级策略）
            next();
        }
    };
};

/**
 * 按API类型限流
 */
export const rateLimitByApiType = async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.userId;
    const apiType = req.body?.apiType || 'dream';

    if (!userId) {
        return next();
    }

    // 不同API类型使用不同的限流策略
    const limits: Record<string, { windowMs: number; max: number }> = {
        dream: { windowMs: 60000, max: 10 }, // 1分钟内最多10次
        nano: { windowMs: 60000, max: 10 }
    };

    const limit = limits[apiType] || limits.dream;
    if (!limit) {
        return next();
    }
    
    const key = `rate_limit:${apiType}:${userId}`;

    try {
        const current = await redis.get(key);
        const count = current ? parseInt(current) : 0;

        if (count >= limit.max) {
            const ttl = await redis.ttl(key);
            const waitSeconds = ttl > 0 ? ttl : Math.ceil(limit.windowMs / 1000);
            return res.status(429).json({
                message: `${apiType === 'dream' ? '即梦AI' : 'Nano'}请求过于频繁，请${waitSeconds}秒后再试`,
                retryAfter: waitSeconds
            });
        }

        if (count === 0) {
            await redis.setex(key, Math.ceil(limit.windowMs / 1000), '1');
        } else {
            await redis.incr(key);
        }

        next();
    } catch (error: any) {
        console.error('[RateLimit] 错误:', error);
        next();
    }
};
