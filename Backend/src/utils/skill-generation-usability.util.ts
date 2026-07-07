import type { SkillInput } from "./skill-validation.util";

export type SkillUsabilityLevel = "ok" | "warn" | "block";

export type SkillUsabilityCategory =
    | "generation"
    | "storyboard"
    | "style"
    | "unsupported"
    | "unknown";

export type SkillUsabilityResult = {
    usable: boolean;
    level: SkillUsabilityLevel;
    category: SkillUsabilityCategory;
    reason: string;
};

/** 与本平台（生图/生视频/分镜）明显无关的 Skill 特征 */
const BLOCK_SIGNALS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bpdf\b|pdf processing|pdf form/i, reason: "PDF 文档处理类 Skill 无法在本平台执行" },
    { pattern: /\bdocx\b|\bdoc\b|word document|microsoft word/i, reason: "Word 文档类 Skill 无法在本平台执行" },
    { pattern: /\bpptx\b|powerpoint|presentation slide/i, reason: "PPT 演示文稿类 Skill 无法在本平台执行" },
    { pattern: /\bxlsx\b|spreadsheet|excel workbook/i, reason: "Excel 表格类 Skill 无法在本平台执行" },
    { pattern: /mcp[- ]?builder|model context protocol/i, reason: "MCP/工具构建类 Skill 需要 Agent 运行时，本平台不支持" },
    { pattern: /code review|pull request|git commit|refactor codebase/i, reason: "代码开发类 Skill 与本平台生图/生视频无关" },
    { pattern: /slack gif|internal comms|doc-coauthoring/i, reason: "办公协作类 Skill 无法用于图像/视频生成" },
    { pattern: /webapp testing|playwright|selenium/i, reason: "Web 测试类 Skill 无法在本平台执行" },
    { pattern: /execute scripts?|run bash|shell script|npm install/i, reason: "依赖脚本执行的 Skill 本平台不会运行 scripts/" },
];

const GENERATION_SIGNALS: Array<{ pattern: RegExp; category: SkillUsabilityCategory }> = [
    { pattern: /四格漫画|comic|漫画|条漫/i, category: "storyboard" },
    { pattern: /分镜|storyboard|镜头拆分|shot list/i, category: "storyboard" },
    { pattern: /生图|生视频|image generat|video generat|text-to-image|图生视频/i, category: "generation" },
    { pattern: /提示词|prompt engineering|midjourney|seedream|seedance|kling|pixverse/i, category: "generation" },
    { pattern: /frontend design|canvas design|algorithmic art|brand guideline|视觉|插画|风格/i, category: "style" },
    { pattern: /镜头|运镜|cinematic|storyboard|画面比例/i, category: "generation" },
];

const BLOCKED_MARKETPLACE_SLUGS = new Set([
    "pdf",
    "docx",
    "pptx",
    "xlsx",
    "mcp-builder",
    "doc-coauthoring",
    "internal-comms",
    "slack-gif-creator",
    "skill-creator",
    "webapp-testing",
    "claude-api",
]);

const ALLOWED_MARKETPLACE_SLUGS = new Set([
    "frontend-design",
    "canvas-design",
    "algorithmic-art",
    "brand-guidelines",
    "theme-factory",
    "four-panel-comic",
]);

function readMetaSkillType(metadata_json?: string): string | undefined {
    if (!metadata_json) return undefined;
    try {
        const meta = JSON.parse(metadata_json) as {
            agent_skill?: { skill_type?: string; builtin?: boolean };
        };
        return meta.agent_skill?.skill_type;
    } catch {
        return undefined;
    }
}

function isBuiltinSource(input: SkillInput): boolean {
    if (input.source_path?.startsWith("builtin://")) return true;
    if (!input.metadata_json) return false;
    try {
        const meta = JSON.parse(input.metadata_json) as { agent_skill?: { builtin?: boolean } };
        return !!meta.agent_skill?.builtin;
    } catch {
        return false;
    }
}

function buildCorpus(input: SkillInput): string {
    return [input.name, input.description, input.content?.slice(0, 800), input.source_path]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
}

export function assessGenerationSkillUsability(input: SkillInput): SkillUsabilityResult {
    if (isBuiltinSource(input)) {
        return {
            usable: true,
            level: "ok",
            category: "generation",
            reason: "内置生成 Skill，可直接使用",
        };
    }

    const skillType = readMetaSkillType(input.metadata_json);
    if (skillType === "comic" || skillType === "storyboard" || skillType === "generation") {
        return {
            usable: true,
            level: "ok",
            category: skillType === "comic" || skillType === "storyboard" ? "storyboard" : "generation",
            reason: "已标记为生成类 Skill",
        };
    }

    const corpus = buildCorpus(input);

    for (const { pattern, reason } of BLOCK_SIGNALS) {
        if (pattern.test(corpus)) {
            return {
                usable: false,
                level: "block",
                category: "unsupported",
                reason,
            };
        }
    }

    for (const { pattern, category } of GENERATION_SIGNALS) {
        if (pattern.test(corpus)) {
            return {
                usable: true,
                level: "ok",
                category,
                reason: "适用于生图/生视频或分镜提示词",
            };
        }
    }

    const scope = input.scope;
    if (scope === "image" || scope === "video") {
        return {
            usable: true,
            level: "warn",
            category: "unknown",
            reason: "未检测到明确生成场景描述，但适用范围为生图/生视频，可尝试使用",
        };
    }

    if (input.format === "plain" || !input.format) {
        return {
            usable: true,
            level: "warn",
            category: "unknown",
            reason: "纯文本 Skill，请确认内容用于提示词融合而非外部工具",
        };
    }

    return {
        usable: false,
        level: "block",
        category: "unsupported",
        reason:
            "该 Skill 未识别为生图/生视频/分镜相关能力（如 PDF、代码、办公文档类）。本平台仅支持将 Skill 规则融入提示词与分镜流程。",
    };
}

export function assertSkillUsableForGeneration(input: SkillInput, index?: number): SkillUsabilityResult {
    const result = assessGenerationSkillUsability(input);
    const prefix = index != null ? `第 ${index + 1} 条 Skill：` : "";
    if (!result.usable) {
        throw new Error(`${prefix}${result.reason}`);
    }
    return result;
}

export function assessMarketplaceSlug(slug: string): SkillUsabilityResult {
    if (ALLOWED_MARKETPLACE_SLUGS.has(slug)) {
        return {
            usable: true,
            level: "ok",
            category: "style",
            reason: "推荐用于生图风格与视觉设计",
        };
    }
    if (BLOCKED_MARKETPLACE_SLUGS.has(slug)) {
        return {
            usable: false,
            level: "block",
            category: "unsupported",
            reason: "该 Skill 属于文档/代码/工具类，本平台无法使用",
        };
    }
    return {
        usable: true,
        level: "warn",
        category: "unknown",
        reason: "未在推荐列表中，导入前请确认与生图/生视频相关",
    };
}

export function isMarketplaceSlugInstallable(slug: string): boolean {
    return assessMarketplaceSlug(slug).usable;
}
