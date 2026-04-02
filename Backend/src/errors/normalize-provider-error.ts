import type { ErrorCategory } from "./error-catalog";
import { ERROR_CATALOG_CORE } from "./error-catalog";

export interface NormalizedErrorLog {
    errorKey: string;
    numericCode: number;
    category: ErrorCategory;
    messageZh: string;
}

const PROVIDER_CODE_HINTS: Array<{ match: (code: string) => boolean; result: NormalizedErrorLog }> = [
    {
        match: (c) => c.toLowerCase().includes("privacyinformation"),
        result: {
            errorKey: "LLM_CONTENT_SAFETY",
            numericCode: 30004,
            category: "LLM",
            messageZh:
                "检测到素材可能包含真人或隐私敏感信息，已被拒绝生成，请更换为不含真人的素材后重试。",
        },
    },
    {
        match: (c) => {
            const lc = c.toLowerCase();
            return lc.includes("sensitivecontent") || lc.includes("safety") || lc.includes("policy");
        },
        result: {
            errorKey: "LLM_CONTENT_SAFETY",
            numericCode: ERROR_CATALOG_CORE.LLM_CONTENT_SAFETY.numericCode,
            category: ERROR_CATALOG_CORE.LLM_CONTENT_SAFETY.category,
            messageZh: ERROR_CATALOG_CORE.LLM_CONTENT_SAFETY.messageZh,
        },
    },
];

/**
 * 将上游 HTTP + 原始文案 + provider 错误码归一为统一 error_key / 数字码 / 中文说明。
 */
export function normalizeProviderError(params: {
    httpStatus?: number;
    rawMessage?: string;
    providerCode?: string;
    provider: string;
}): NormalizedErrorLog {
    const status = params.httpStatus;
    const raw = (params.rawMessage || "").trim();
    const lower = raw.toLowerCase();
    const pCode = (params.providerCode || "").trim();

    if (pCode) {
        for (const h of PROVIDER_CODE_HINTS) {
            if (h.match(pCode)) {
                return { ...h.result };
            }
        }
    }

    if (status === 401) {
        const c = ERROR_CATALOG_CORE.LLM_INVALID_KEY;
        return { errorKey: "LLM_INVALID_KEY", numericCode: c.numericCode, category: c.category, messageZh: c.messageZh };
    }

    if (status === 429) {
        if (
            lower.includes("balance not enough") ||
            lower.includes("insufficient balance") ||
            lower.includes("insufficient_quota") ||
            (lower.includes("quota") && lower.includes("insufficient"))
        ) {
            const c = ERROR_CATALOG_CORE.LLM_QUOTA_EXCEEDED;
            return {
                errorKey: "LLM_QUOTA_EXCEEDED",
                numericCode: c.numericCode,
                category: c.category,
                messageZh: c.messageZh,
            };
        }
        const c = ERROR_CATALOG_CORE.LLM_RATE_LIMIT;
        return { errorKey: "LLM_RATE_LIMIT", numericCode: c.numericCode, category: c.category, messageZh: c.messageZh };
    }

    if (
        lower.includes("insufficient_quota") ||
        lower.includes("quota exceeded") ||
        lower.includes("exceeded quota") ||
        (lower.includes("billing") && lower.includes("quota"))
    ) {
        if (lower.includes("rate limit") || lower.includes("too many requests")) {
            const c = ERROR_CATALOG_CORE.LLM_RATE_LIMIT;
            return {
                errorKey: "LLM_RATE_LIMIT",
                numericCode: c.numericCode,
                category: c.category,
                messageZh: c.messageZh,
            };
        }
        const c = ERROR_CATALOG_CORE.LLM_QUOTA_EXCEEDED;
        return {
            errorKey: "LLM_QUOTA_EXCEEDED",
            numericCode: c.numericCode,
            category: c.category,
            messageZh: c.messageZh,
        };
    }

    if (
        lower.includes("rate limit") ||
        lower.includes("too many requests") ||
        lower.includes("resource exhausted")
    ) {
        const c = ERROR_CATALOG_CORE.LLM_RATE_LIMIT;
        return { errorKey: "LLM_RATE_LIMIT", numericCode: c.numericCode, category: c.category, messageZh: c.messageZh };
    }

    if (
        lower.includes("safety") ||
        lower.includes("content_policy") ||
        lower.includes("moderation") ||
        lower.includes("nsfw") ||
        lower.includes("blocked")
    ) {
        const c = ERROR_CATALOG_CORE.LLM_CONTENT_SAFETY;
        return {
            errorKey: "LLM_CONTENT_SAFETY",
            numericCode: c.numericCode,
            category: c.category,
            messageZh: c.messageZh,
        };
    }

    if (
        lower.includes("timeout") ||
        lower.includes("econnreset") ||
        lower.includes("socket hang up") ||
        status === 504 ||
        status === 502
    ) {
        const c = ERROR_CATALOG_CORE.LLM_UPSTREAM_TIMEOUT;
        return {
            errorKey: "LLM_UPSTREAM_TIMEOUT",
            numericCode: c.numericCode,
            category: c.category,
            messageZh: c.messageZh,
        };
    }

    if (status === 400 && raw.length > 0) {
        const u = ERROR_CATALOG_CORE.UNKNOWN_LLM;
        return {
            errorKey: "UNKNOWN_LLM",
            numericCode: u.numericCode,
            category: u.category,
            messageZh: raw.length > 200 ? u.messageZh : raw,
        };
    }

    const u = ERROR_CATALOG_CORE.UNKNOWN_LLM;
    return { errorKey: "UNKNOWN_LLM", numericCode: u.numericCode, category: u.category, messageZh: u.messageZh };
}
