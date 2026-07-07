import type { SkillApplyItem } from "../services/skill-apply.service";

/** 内置生成 Skill（全员可用，slug 唯一） */
export type BuiltinGenerationSkill = {
    slug: string;
    name: string;
    description: string;
    scope: "image" | "video" | "both";
    format: "agent_skill";
    apply_mode: "preprocess";
    content: string;
    skill_type: "generation" | "storyboard" | "comic";
    metadata_json: string;
};

export const FOUR_PANEL_COMIC_SKILL: BuiltinGenerationSkill = {
    slug: "four-panel-comic",
    name: "四格漫画生成",
    description:
        "将用户文案拆分为标准四格漫画（起承转合），生成中文生图提示词。适用于条漫、故事漫画、产品叙事四格图。需提供内容文案与角色/风格参考图。",
    scope: "image",
    format: "agent_skill",
    apply_mode: "preprocess",
    skill_type: "comic",
    content: `## 四格漫画拆分规则

你必须将用户文案拆成 **恰好 4 格**，对应叙事结构：
1. **第 1 格（起）**：建立情境、人物出场或抛出背景
2. **第 2 格（承）**：推进情节、增加信息或冲突酝酿
3. **第 3 格（转）**：转折、高潮、意外或情绪爆发
4. **第 4 格（合）**：结局、包袱、反转或余韵

## 提示词要求（每格独立生图）

每格 prompt 必须为 **中文**，且包含：
- **画幅**：单格漫画插画，适合 1:1 方图
- **风格**：日式/国漫四格漫画风格、清晰线稿或赛璐璐上色、对话框留白（无文字）
- **角色一致**：若用户提供参考图，每格 prompt 中重复相同角色外貌特征（发型、服装、配色）
- **构图**：明确景别（特写/中景/全景），单一焦点，背景简洁可读
- **禁止**：不要在 prompt 里要求绘制汉字、对白文字、水印、Logo

## 参考图使用

- 用户连线或上传的参考图用于 **角色外形与画风** 统一
- 四格之间同一主角的描述词保持一致
- 可在 negativePrompt 中写：文字、水印、畸形手指、模糊

## 输出 JSON 字段说明

每格 shotDescription 用一句话概括本格剧情；scriptExcerpt 为对应原文片段。`,
    metadata_json: JSON.stringify({
        agent_skill: {
            slug: "four-panel-comic",
            standard: "agentskills.io",
            skill_type: "comic",
            builtin: true,
            panels: 4,
            output: "image",
            aspect_ratio: "1:1",
        },
    }),
};

export const BUILTIN_GENERATION_SKILLS: BuiltinGenerationSkill[] = [FOUR_PANEL_COMIC_SKILL];

export function getBuiltinSkillBySlug(slug: string): BuiltinGenerationSkill | undefined {
    return BUILTIN_GENERATION_SKILLS.find((s) => s.slug === slug);
}

export function builtinToSkillApplyItem(skill: BuiltinGenerationSkill): SkillApplyItem {
    return {
        name: skill.name,
        content: skill.content,
        format: skill.format,
        apply_mode: skill.apply_mode,
        description: skill.description,
    };
}

export function builtinToSkillInput(skill: BuiltinGenerationSkill) {
    return {
        name: skill.name,
        content: skill.content,
        scope: skill.scope,
        description: skill.description,
        format: skill.format,
        apply_mode: skill.apply_mode,
        metadata_json: skill.metadata_json,
        source_path: `builtin://${skill.slug}`,
    };
}
