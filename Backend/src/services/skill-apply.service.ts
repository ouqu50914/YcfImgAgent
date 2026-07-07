import { PromptService } from "./prompt.service";
import type { GenerationSkillApplyMode, GenerationSkillFormat } from "../entities/GenerationSkill";
import { isAgentSkillFormat } from "../utils/skill-validation.util";

export type SkillApplyItem = {
    name?: string;
    content: string;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    description?: string;
};

const SKILL_APPLY_SYSTEM = `你是一个 AI 生图/生视频提示词工程师。
用户会提供一条或多条 Skill 规则，以及用户的原始提示词。
你的任务：严格遵循 Skill 中的风格、角色、镜头、禁止项等约束，将 Skill 规则融入最终提示词，输出一条可直接用于生成模型的中文提示词。

要求：
1. 保留用户原始意图与主体描述，不要丢弃关键信息；
2. Skill 中的禁止项必须体现在输出中；
3. 不要输出解释、标题、Markdown、代码块，只输出最终提示词正文；
4. 若 Skill 与用户提示冲突，以 Skill 约束优先，但保留用户指定的主体对象；
5. 输出长度控制在 800 字以内。`;

function buildMergeBlock(skills: SkillApplyItem[]): string {
    return skills
        .map((s) => {
            const header = s.name ? `【Skill: ${s.name}】` : "【Skill】";
            return `${header}\n${s.content.trim()}`;
        })
        .join("\n\n");
}

function mergeSkillWithPrompt(skills: SkillApplyItem[], userPrompt: string): string {
    const prompt = userPrompt.trim();
    const blocks = skills.map((s) => s.content.trim()).filter(Boolean);
    const merged = buildMergeBlock(skills);
    if (!merged) return prompt;
    if (!prompt) return merged;
    return `${merged}\n\n---\n\n${prompt}`;
}

export class SkillApplyService {
    private promptService = new PromptService();

    async applySkillsToPrompt(params: {
        skills: SkillApplyItem[];
        userPrompt: string;
        target: "image" | "video";
    }): Promise<{ prompt: string; usedPreprocess: boolean }> {
        const userPrompt = params.userPrompt.trim();
        const skills = params.skills.filter((s) => s.content?.trim());

        const mergeSkills = skills.filter((s) => (s.apply_mode || "merge") === "merge");
        const preprocessSkills = skills.filter((s) => s.apply_mode === "preprocess");

        let basePrompt = userPrompt;

        if (preprocessSkills.length > 0) {
            const targetLabel = params.target === "video" ? "生视频" : "生图";
            const skillBlocks = preprocessSkills
                .map((s) => {
                    const fmt = isAgentSkillFormat(s.format) ? " [Agent Skills 标准]" : "";
                    const desc = s.description ? `\n描述：${s.description}` : "";
                    return `### ${s.name || "Skill"}${fmt}${desc}\n${s.content.trim()}`;
                })
                .join("\n\n");

            const userMessage =
                `生成类型：${targetLabel}\n\n` +
                `## Skill 规则\n${skillBlocks}\n\n` +
                `## 用户提示词\n${userPrompt || "（用户未提供额外提示，请仅按 Skill 生成合适提示词）"}\n\n` +
                `请输出融合后的最终提示词：`;

            try {
                const processed = await this.promptService.chatWithGemini(
                    [
                        { role: "system", content: SKILL_APPLY_SYSTEM },
                        { role: "user", content: userMessage },
                    ],
                    { temperature: 0.4, maxTokens: 1200, debugTag: "skill_apply" }
                );
                const trimmed = processed.trim();
                if (trimmed) basePrompt = trimmed;
            } catch (error) {
                console.warn("[SkillApplyService] Gemini 预处理失败，回退为 merge 模式", error);
                mergeSkills.push(...preprocessSkills);
            }
        }

        const finalPrompt = mergeSkills.length > 0 ? mergeSkillWithPrompt(mergeSkills, basePrompt) : basePrompt;

        return {
            prompt: finalPrompt.trim() || userPrompt,
            usedPreprocess: preprocessSkills.length > 0,
        };
    }
}
