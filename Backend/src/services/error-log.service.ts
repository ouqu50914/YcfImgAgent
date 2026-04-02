import { AppDataSource } from "../data-source";
import { ErrorEvent } from "../entities/ErrorEvent";
import { resolveForErrorLog } from "../errors/resolve-for-error-log";
import { isAppError } from "../errors/app-error";
import { getCatalogEntry } from "../errors/error-catalog";
import { getRequestTraceId } from "../utils/request-trace";
import type { Request } from "express";

const MAX_RAW_LEN = 2048;

function truncateRaw(s: string | undefined): string | null {
    if (!s || !s.trim()) return null;
    const t = s.trim();
    return t.length <= MAX_RAW_LEN ? t : t.slice(0, MAX_RAW_LEN) + "…";
}

function sanitizeContext(ctx: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!ctx || typeof ctx !== "object") return null;
    const out: Record<string, unknown> = { ...ctx };
    delete out.password;
    delete out.token;
    delete out.refreshToken;
    delete out.authorization;
    delete out.Authorization;
    const maxPrompt = Math.min(Math.max(Number(process.env.ERROR_LOG_PROMPT_MAX_LEN) || 200, 0), 2000);
    if (typeof out.prompt === "string") {
        const p = out.prompt;
        out.prompt_length = p.length;
        out.prompt_preview = p.slice(0, maxPrompt);
        delete out.prompt;
    }
    return out;
}

export interface ErrorLogRecordInput {
    traceId: string;
    errorKey: string;
    messageZh: string;
    messageRaw?: string | null;
    httpStatus: number;
    source: string;
    provider?: string | null;
    providerCode?: string | null;
    userId?: number | null;
    requestPath?: string | null;
    method?: string | null;
    context?: Record<string, unknown> | null;
    /** 若已解析（如 AppError），可跳过 resolveForErrorLog */
    numericCode?: number | null;
    category?: string | null;
}

export class ErrorLogService {
    private repo = AppDataSource.getRepository(ErrorEvent);

    /**
     * 异步落库，不阻塞请求主路径。
     */
    record(input: ErrorLogRecordInput): void {
        setImmediate(() => {
            void this.persist(input).catch((e) => console.error("[ErrorLogService] persist failed", e));
        });
    }

    private async persist(input: ErrorLogRecordInput): Promise<void> {
        let errorKey = input.errorKey;
        let messageZh = input.messageZh;
        let numericCode: number | null = input.numericCode ?? null;
        let category = input.category ?? "SYSTEM";

        if (input.numericCode != null && input.category != null) {
            errorKey = input.errorKey;
            messageZh = input.messageZh;
            numericCode = input.numericCode;
            category = input.category;
        } else {
            const resolved = resolveForErrorLog({
                errorKey: input.errorKey,
                messageZh: input.messageZh,
                httpStatus: input.httpStatus,
                ...(input.messageRaw != null && input.messageRaw !== ""
                    ? { messageRaw: input.messageRaw }
                    : {}),
                ...(input.provider != null && input.provider !== "" ? { provider: input.provider } : {}),
                ...(input.providerCode != null && input.providerCode !== ""
                    ? { providerCode: input.providerCode }
                    : {}),
            });
            errorKey = resolved.errorKey;
            messageZh = resolved.messageZh;
            numericCode = resolved.numericCode;
            category = resolved.category;
        }

        const row = new ErrorEvent();
        row.trace_id = input.traceId;
        row.error_key = errorKey;
        row.message_zh = messageZh;
        row.message_raw = truncateRaw(input.messageRaw ?? undefined);
        row.numeric_code = numericCode;
        row.category = category;
        row.http_status = input.httpStatus;
        row.source = input.source;
        row.provider = input.provider ?? null;
        row.provider_code = input.providerCode ?? null;
        row.user_id = input.userId ?? null;
        row.request_path = input.requestPath ?? null;
        row.method = input.method ?? null;
        row.context = sanitizeContext(input.context ?? null);

        await this.repo.save(row);
    }

    async queryPage(filters: {
        page?: number;
        pageSize?: number;
        userId?: number;
        errorKey?: string;
        numericCode?: number;
        provider?: string;
        traceId?: string;
        from?: Date;
        to?: Date;
    }): Promise<{ list: ErrorEvent[]; total: number; page: number; pageSize: number }> {
        const page = Math.max(1, filters.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
        const qb = this.repo.createQueryBuilder("e");

        if (filters.userId != null) {
            qb.andWhere("e.user_id = :uid", { uid: filters.userId });
        }
        if (filters.errorKey) {
            qb.andWhere("e.error_key = :ek", { ek: filters.errorKey });
        }
        if (filters.numericCode != null) {
            qb.andWhere("e.numeric_code = :nc", { nc: filters.numericCode });
        }
        if (filters.provider) {
            qb.andWhere("e.provider = :pv", { pv: filters.provider });
        }
        if (filters.traceId) {
            qb.andWhere("e.trace_id = :tid", { tid: filters.traceId });
        }
        if (filters.from) {
            qb.andWhere("e.created_at >= :from", { from: filters.from });
        }
        if (filters.to) {
            qb.andWhere("e.created_at <= :to", { to: filters.to });
        }

        const total = await qb.clone().getCount();
        const list = await qb
            .orderBy("e.created_at", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize)
            .getMany();

        return { list, total, page, pageSize };
    }

    /**
     * 从 Express 错误对象与请求上下文记录一条错误（控制器 catch 使用）。
     */
    recordFromRequest(
        req: Request,
        err: unknown,
        overrides?: Partial<Pick<ErrorLogRecordInput, "source" | "provider" | "context">>
    ): void {
        const traceId = req.traceId ?? getRequestTraceId();
        const userId = req.user?.userId ?? null;
        const rawMsg =
            err instanceof Error
                ? `${err.message}${err.stack ? "\n" + err.stack.slice(0, 1500) : ""}`
                : String(err);

        if (isAppError(err)) {
            const cat = getCatalogEntry(err.code);
            this.record({
                traceId,
                errorKey: err.code,
                messageZh: err.messageZh,
                messageRaw: rawMsg,
                httpStatus: err.status,
                source: overrides?.source ?? err.source,
                provider: overrides?.provider ?? err.provider,
                providerCode: err.providerCode,
                userId,
                requestPath: req.path,
                method: req.method,
                context: overrides?.context ?? null,
                numericCode: err.numericCode ?? cat?.numericCode ?? null,
                category: err.category ?? cat?.category ?? null,
            });
            return;
        }

        const anyErr = err as any;
        const status =
            typeof anyErr?.status === "number" && anyErr.status >= 400 && anyErr.status < 600
                ? anyErr.status
                : 500;
        const code =
            typeof anyErr?.code === "string" && anyErr.code.trim()
                ? anyErr.code.trim()
                : "UNKNOWN_ERROR";

        const providerCode =
            typeof anyErr?.code === "string" && anyErr.code.includes(".") ? anyErr.code : null;

        this.record({
            traceId,
            errorKey: code,
            messageZh: anyErr?.message && typeof anyErr.message === "string" ? anyErr.message : "请求处理失败",
            messageRaw: rawMsg,
            httpStatus: status,
            source: overrides?.source ?? "controller",
            provider: overrides?.provider ?? null,
            providerCode,
            userId,
            requestPath: req.path,
            method: req.method,
            context: overrides?.context ?? null,
        });
    }
}
