import type {
    GenerationSkillApplyMode,
    GenerationSkillFormat,
    GenerationSkillScope,
} from "../entities/GenerationSkill";

export const SKILL_LIMITS = {
    NAME_MIN: 1,
    NAME_MAX: 100,
    CONTENT_MIN: 1,
    CONTENT_MAX: 20000,
    DESCRIPTION_MAX: 200,
    METADATA_MAX: 50000,
    IMPORT_BATCH_MAX: 50,
} as const;

const VALID_SCOPES: GenerationSkillScope[] = ["image", "video", "both"];
const VALID_FORMATS: GenerationSkillFormat[] = ["plain", "agent_skill", "cursor_skill"];

export function isAgentSkillFormat(format?: string): boolean {
    return format === "agent_skill" || format === "cursor_skill";
}
const VALID_APPLY_MODES: GenerationSkillApplyMode[] = ["merge", "preprocess"];

export type SkillInput = {
    name?: string;
    content?: string;
    scope?: string;
    description?: string;
    format?: string;
    apply_mode?: string;
    metadata_json?: string;
    source_path?: string;
};

export function normalizeSkillScope(scope?: string): GenerationSkillScope {
    if (scope && VALID_SCOPES.includes(scope as GenerationSkillScope)) {
        return scope as GenerationSkillScope;
    }
    return "both";
}

export function normalizeSkillFormat(format?: string): GenerationSkillFormat {
    if (format === "cursor_skill" || format === "agent_skill") return "agent_skill";
    if (format === "plain") return "plain";
    return "plain";
}

export function normalizeSkillApplyMode(mode?: string, format?: GenerationSkillFormat): GenerationSkillApplyMode {
    if (mode && VALID_APPLY_MODES.includes(mode as GenerationSkillApplyMode)) {
        return mode as GenerationSkillApplyMode;
    }
    return isAgentSkillFormat(format) ? "preprocess" : "merge";
}

export function validateSkillInput(input: SkillInput, index?: number): {
    name: string;
    content: string;
    scope: GenerationSkillScope;
    description?: string;
    format: GenerationSkillFormat;
    apply_mode: GenerationSkillApplyMode;
    metadata_json?: string;
    source_path?: string;
} {
    const prefix = index != null ? `第 ${index + 1} 条 Skill：` : "";

    const name = typeof input.name === "string" ? input.name.trim() : "";
    const content = typeof input.content === "string" ? input.content.trim() : "";
    const description =
        typeof input.description === "string" && input.description.trim()
            ? input.description.trim()
            : undefined;
    const format = normalizeSkillFormat(input.format);
    const apply_mode = normalizeSkillApplyMode(input.apply_mode, format);
    const metadata_json =
        typeof input.metadata_json === "string" && input.metadata_json.trim()
            ? input.metadata_json.trim()
            : undefined;
    const source_path =
        typeof input.source_path === "string" && input.source_path.trim()
            ? input.source_path.trim().slice(0, 500)
            : undefined;

    if (!name) throw new Error(`${prefix}名称不能为空`);
    if (name.length > SKILL_LIMITS.NAME_MAX) {
        throw new Error(`${prefix}名称不能超过 ${SKILL_LIMITS.NAME_MAX} 个字符`);
    }

    if (!content) throw new Error(`${prefix}指令内容不能为空`);
    if (content.length > SKILL_LIMITS.CONTENT_MAX) {
        throw new Error(`${prefix}指令内容不能超过 ${SKILL_LIMITS.CONTENT_MAX} 个字符`);
    }

    if (description && description.length > SKILL_LIMITS.DESCRIPTION_MAX) {
        throw new Error(`${prefix}描述不能超过 ${SKILL_LIMITS.DESCRIPTION_MAX} 个字符`);
    }

    if (metadata_json && metadata_json.length > SKILL_LIMITS.METADATA_MAX) {
        throw new Error(`${prefix}元数据过大`);
    }

    return {
        name,
        content,
        scope: normalizeSkillScope(input.scope),
        format,
        apply_mode,
        ...(description ? { description } : {}),
        ...(metadata_json ? { metadata_json } : {}),
        ...(source_path ? { source_path } : {}),
    };
}

function assignValidatedToEntity(
    skill: {
        name: string;
        content: string;
        scope: GenerationSkillScope;
        description?: string;
        format: GenerationSkillFormat;
        apply_mode: GenerationSkillApplyMode;
        metadata_json?: string;
        source_path?: string;
    },
    validated: ReturnType<typeof validateSkillInput>
) {
    skill.name = validated.name;
    skill.content = validated.content;
    skill.scope = validated.scope;
    skill.format = validated.format;
    skill.apply_mode = validated.apply_mode;
    if (validated.description) {
        skill.description = validated.description;
    } else {
        delete (skill as { description?: string }).description;
    }
    if (validated.metadata_json) {
        skill.metadata_json = validated.metadata_json;
    } else {
        delete (skill as { metadata_json?: string }).metadata_json;
    }
    if (validated.source_path) {
        skill.source_path = validated.source_path;
    } else {
        delete (skill as { source_path?: string }).source_path;
    }
}

export { assignValidatedToEntity };
