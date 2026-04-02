import type { Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import { ErrorLogService } from "../services/error-log.service";
import { getRequestTraceId } from "../utils/request-trace";
import { resolveForErrorLog } from "../errors/resolve-for-error-log";

interface ErrorResponseBody {
    status: number;
    code: string;
    message: string;
    details?: string;
    trace_id?: string;
    numeric_code?: number;
}

const errorLogService = new ErrorLogService();

const isMulterError = (err: any): err is MulterError => {
    return !!err && (err instanceof multer.MulterError || err.name === "MulterError");
};

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    // 如果响应头已经发送，交给默认的 Express 处理
    if (res.headersSent) {
        return next(err);
    }

    let status = 500;
    let code = "UNKNOWN_ERROR";
    let message = "服务器开小差了，请稍后重试。";
    let details: string | undefined;

    // 特殊处理 Multer 上传错误（文件过大、数量超限等）
    if (isMulterError(err)) {
        details = err.message;

        if (err.code === "LIMIT_FILE_SIZE") {
            status = 413;
            code = "UPLOAD_FILE_TOO_LARGE";
            message = "单张图片大小不能超过 10MB，请压缩后再试。";
        } else if (err.code === "LIMIT_FILE_COUNT") {
            status = 400;
            code = "UPLOAD_FILE_COUNT_LIMIT";
            message = "一次上传的图片数量超出限制，请分批上传。";
        } else {
            status = 400;
            code = "UPLOAD_ERROR";
            message = "图片上传失败，请检查文件后重试。";
        }
    } else if (err && typeof err.message === "string") {
        // 针对 fileFilter 或业务抛出的 Error 做简单归类
        details = err.message;

        if (err.message.includes("只允许上传图片文件")) {
            status = 400;
            code = "UPLOAD_FILE_TYPE_NOT_ALLOWED";
            message = "仅支持 jpg、png、gif、webp 等常见图片格式。";
        } else if (err.message.includes("未授权") || err.message.includes("未登录")) {
            status = 401;
            code = "UPLOAD_AUTH_REQUIRED";
            message = "请先登录后再上传图片。";
        }
    }

    const traceId = req.traceId ?? getRequestTraceId();
    const resolved = resolveForErrorLog({
        errorKey: code,
        messageZh: message,
        httpStatus: status,
        ...(details !== undefined && details !== "" ? { messageRaw: details } : {}),
    });
    const body: ErrorResponseBody = {
        status,
        code: resolved.errorKey,
        message: resolved.messageZh,
        trace_id: traceId,
        numeric_code: resolved.numericCode,
    };
    if (process.env.NODE_ENV !== "production" && details) {
        body.details = details;
    }

    errorLogService.record({
        traceId,
        errorKey: resolved.errorKey,
        messageZh: resolved.messageZh,
        messageRaw: details ?? message,
        httpStatus: status,
        source: "middleware",
        userId: req.user?.userId ?? null,
        requestPath: req.path,
        method: req.method,
        numericCode: resolved.numericCode,
        category: resolved.category,
    });

    // 记录到控制台，便于排查
    console.error("[errorHandler]", {
        path: req.path,
        method: req.method,
        status,
        code: resolved.errorKey,
        details,
        trace_id: traceId,
    });

    res.status(status).json(body);
}

