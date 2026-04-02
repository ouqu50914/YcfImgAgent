export type ErrorCategory = "SYSTEM" | "CLIENT" | "LLM";

export interface CatalogEntry {
    numericCode: number;
    category: ErrorCategory;
    messageZh: string;
}

/** error_key（字符串码）→ 数字码 + 分类 + 默认中文（用 const 保证键访问非 undefined） */
const ERROR_CATALOG_CORE = {
    UNKNOWN_ERROR: {
        numericCode: 10999,
        category: "SYSTEM",
        messageZh: "服务器开小差了，请稍后重试。",
    },

    UPLOAD_FILE_TOO_LARGE: {
        numericCode: 20004,
        category: "CLIENT",
        messageZh: "单张图片大小不能超过 10MB，请压缩后再试。",
    },
    UPLOAD_FILE_COUNT_LIMIT: {
        numericCode: 20005,
        category: "CLIENT",
        messageZh: "一次上传的图片数量超出限制，请分批上传。",
    },
    UPLOAD_ERROR: {
        numericCode: 20006,
        category: "CLIENT",
        messageZh: "图片上传失败，请检查文件后重试。",
    },
    UPLOAD_FILE_TYPE_NOT_ALLOWED: {
        numericCode: 20007,
        category: "CLIENT",
        messageZh: "仅支持 jpg、png、gif、webp 等常见图片格式。",
    },
    UPLOAD_AUTH_REQUIRED: {
        numericCode: 20008,
        category: "CLIENT",
        messageZh: "请先登录后再上传图片。",
    },

    ACCOUNT_IN_ARREARS: {
        numericCode: 20003,
        category: "CLIENT",
        messageZh: "账户余额不足，请先充值后再使用。",
    },

    UPSTREAM_UNAUTHORIZED: {
        numericCode: 30001,
        category: "LLM",
        messageZh: "上游服务鉴权失败，请检查 API 密钥或联系管理员。",
    },

    LLM_INVALID_KEY: {
        numericCode: 30001,
        category: "LLM",
        messageZh: "模型 API 密钥无效或过期，请联系管理员检查配置。",
    },
    LLM_QUOTA_EXCEEDED: {
        numericCode: 30002,
        category: "LLM",
        messageZh: "模型 API 配额或余额不足，请稍后重试或联系管理员充值。",
    },
    LLM_RATE_LIMIT: {
        numericCode: 30003,
        category: "LLM",
        messageZh: "当前请求过于频繁，请稍后再试。",
    },
    LLM_CONTENT_SAFETY: {
        numericCode: 30004,
        category: "LLM",
        messageZh: "内容未通过安全审核，请修改提示词或素材后重试。",
    },
    LLM_UPSTREAM_TIMEOUT: {
        numericCode: 30005,
        category: "LLM",
        messageZh: "模型服务响应超时，请稍后重试。",
    },
    UNKNOWN_LLM: {
        numericCode: 30999,
        category: "LLM",
        messageZh: "模型服务暂时不可用，请稍后重试。",
    },

    ACE_REQUEST_BODY_TOO_LARGE: {
        numericCode: 30006,
        category: "LLM",
        messageZh: "请求体过大，请减少图片数量或尺寸后重试。",
    },
    ACE_IMAGE_URL_TO_BASE64_FAILED: {
        numericCode: 30007,
        category: "LLM",
        messageZh: "图片地址无法读取，请检查链接是否有效。",
    },
    ACE_GENERATED_IMAGE_EMPTY: {
        numericCode: 30008,
        category: "LLM",
        messageZh: "模型未返回有效图片，请更换提示词或稍后重试。",
    },
    ACE_TASK_FAILED: {
        numericCode: 30009,
        category: "LLM",
        messageZh: "生成任务失败，请稍后重试。",
    },
} satisfies Record<string, CatalogEntry>;

export { ERROR_CATALOG_CORE };

export const ERROR_CATALOG: Record<string, CatalogEntry> = ERROR_CATALOG_CORE;

export function getCatalogEntry(errorKey: string): CatalogEntry | undefined {
    if (Object.prototype.hasOwnProperty.call(ERROR_CATALOG_CORE, errorKey)) {
        return ERROR_CATALOG_CORE[errorKey as keyof typeof ERROR_CATALOG_CORE];
    }
    return undefined;
}
