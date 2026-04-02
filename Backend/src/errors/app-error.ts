import type { ErrorCategory } from "./error-catalog";

/**
 * 业务/上游错误：携带统一错误码，供控制器返回与 ErrorLog 记录。
 */
export class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly numericCode: number | null;
    readonly category: ErrorCategory;
    readonly messageZh: string;
    readonly provider: string | null;
    readonly providerCode: string | null;
    readonly source: string;

    constructor(params: {
        status: number;
        code: string;
        messageZh: string;
        numericCode?: number | null;
        category?: ErrorCategory;
        provider?: string | null;
        providerCode?: string | null;
        source?: string;
        cause?: unknown;
    }) {
        super(params.messageZh);
        this.name = "AppError";
        this.status = params.status;
        this.code = params.code;
        this.messageZh = params.messageZh;
        this.numericCode = params.numericCode ?? null;
        this.category = params.category ?? "SYSTEM";
        this.provider = params.provider ?? null;
        this.providerCode = params.providerCode ?? null;
        this.source = params.source ?? "controller";
        if (params.cause !== undefined) {
            (this as any).cause = params.cause;
        }
    }
}

export function isAppError(e: unknown): e is AppError {
    return e instanceof AppError;
}
