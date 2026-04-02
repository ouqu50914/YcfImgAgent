import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

const traceStorage = new AsyncLocalStorage<{ traceId: string }>();

/**
 * 在 Express 中间件内对 next() 调用包装，使后续异步链路可读取同一 traceId。
 */
export function runWithRequestTrace<T>(traceId: string, fn: () => T): T {
    return traceStorage.run({ traceId }, fn);
}

export function getRequestTraceId(): string {
    return traceStorage.getStore()?.traceId ?? randomUUID();
}
