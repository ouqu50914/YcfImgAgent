import { PromptService } from "./prompt.service";
import type { SkillApplyItem } from "./skill-apply.service";
import { isAgentSkillFormat } from "../utils/skill-validation.util";
import {
    FOUR_PANEL_COMIC_SKILL,
    builtinToSkillApplyItem,
} from "../data/builtin-generation-skills";

export type StoryboardTemplate = "default" | "four_panel_comic";

export type StoryboardPhase = "split" | "prompts" | "full";

export type StoryboardShot = {
    id: string;
    sequence: number;
    title?: string;
    scriptExcerpt: string;
    shotDescription: string;
    camera?: string;
    durationSec: number;
    prompt: string;
    negativePrompt?: string;
    referenceImageUrl?: string | null;
};

export type StoryboardGenerateInput = {
    script: string;
    skills?: SkillApplyItem[];
    maxShots?: number;
    aspectRatio?: string;
    template?: StoryboardTemplate;
    phase?: StoryboardPhase;
    /** phase=prompts 时传入已确认的分镜结构 */
    shots?: StoryboardShot[];
};

const SPLIT_STORYBOARD_SYSTEM = `你是一位专业分镜导演。
你的任务：根据用户提供的剧本/脚本，拆分为可独立拍摄的镜头结构。

输出要求（极其重要）：
1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字；
2. JSON 结构必须为：{"shots":[...]}
3. 每个 shot 对象字段：
   - sequence (number): 从 1 开始的序号
   - title (string, 可选): 镜头标题
   - scriptExcerpt (string): 对应原文片段
   - shotDescription (string): 给人看的镜头说明（景别、主体、动作、环境）
   - camera (string, 可选): 运镜方式
   - durationSec (number): 建议时长 3-8 秒
   - prompt (string): **必须留空字符串 ""**，此阶段不要写生成提示词

拆分原则：
- 按场景切换、情绪转折、动作变化切镜
- 每个镜头应可独立理解
- 保持角色、服装、场景在全片中的一致性描述`;

const SPLIT_COMIC_SYSTEM = `你是一位四格漫画分镜师。
你的任务：将用户文案拆成 **恰好 4 格** 漫画分镜结构（起承转合），**此阶段不要写 AI 生图提示词**。

输出要求（极其重要）：
1. 只输出一个 JSON 对象，不要 Markdown 代码块；
2. JSON 结构必须为：{"shots":[...]}，且 shots 数组长度必须 **恰好为 4**；
3. 每个 shot 对象字段：
   - sequence (number): 1 到 4
   - title (string): 起 / 承 / 转 / 合
   - scriptExcerpt (string): 对应原文片段
   - shotDescription (string): 本格剧情一句话（景别、主体、动作）
   - camera (string, 可选): 特写/中景/全景
   - durationSec (number): 固定填 0
   - prompt (string): **必须留空字符串 ""**

四格叙事：第1格起、第2格承、第3格转、第4格合。`;

const PROMPTS_STORYBOARD_SYSTEM = `你是一位 AI 视频提示词工程师。
用户已确认分镜结构，请为每个镜头撰写可直接用于视频生成模型的 **中文提示词**。

输出要求（极其重要）：
1. 只输出 JSON：{"shots":[...]}，shots 数量必须与输入一致、sequence 一一对应；
2. 保留 sequence、title、scriptExcerpt、shotDescription、camera、durationSec；
3. 为每个 shot 填写 prompt（中文视频生成提示词）与可选 negativePrompt；
4. 不要 Markdown 代码块，不要解释文字。`;

const PROMPTS_COMIC_SYSTEM = `你是一位 AI 插画提示词工程师。
用户已确认四格漫画分镜，请为每格撰写可直接用于 **图片生成模型** 的中文提示词。

输出要求（极其重要）：
1. 只输出 JSON：{"shots":[...]}，必须恰好 4 格，sequence 1-4 与输入一致；
2. 保留 sequence、title、scriptExcerpt、shotDescription、camera；
3. prompt 为中文生图提示词：漫画插画风格、角色外貌、动作、背景、光线；不要包含对白文字；
4. negativePrompt 可选，如「文字、水印、畸形、模糊」。`;

const STORYBOARD_SYSTEM = `你是一位专业分镜导演与 AI 视频提示词工程师。
你的任务：根据用户提供的剧本/脚本，拆分为可独立生成的视频镜头，并为每个镜头撰写可直接用于视频生成模型的中文提示词。

输出要求（极其重要）：
1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字；
2. JSON 结构必须为：{"shots":[...]}
3. 每个 shot 对象字段：
   - sequence (number): 从 1 开始的序号
   - title (string, 可选): 镜头标题
   - scriptExcerpt (string): 对应原文片段
   - shotDescription (string): 给人看的镜头说明（景别、主体、动作、环境）
   - camera (string, 可选): 运镜方式，如「缓慢推近」「固定机位」「跟拍」
   - durationSec (number): 建议时长 3-8 秒
   - prompt (string): 中文视频生成提示词，含主体、动作、环境、光线、镜头运动、风格
   - negativePrompt (string, 可选): 负向提示

拆分原则：
- 按场景切换、情绪转折、动作变化切镜，不要机械按句号切
- 每个镜头应可独立生成一段短视频
- 提示词具体、可视化，避免抽象形容词堆砌
- 保持角色、服装、场景在全片中的一致性描述`;

const COMIC_STORYBOARD_SYSTEM = `你是一位四格漫画分镜师与 AI 插画提示词工程师。
你的任务：将用户文案拆成 **恰好 4 格** 漫画分镜，并为每格撰写可直接用于 **图片生成模型** 的中文提示词。

输出要求（极其重要）：
1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字；
2. JSON 结构必须为：{"shots":[...]}，且 shots 数组长度必须 **恰好为 4**；
3. 每个 shot 对象字段：
   - sequence (number): 1 到 4
   - title (string): 起 / 承 / 转 / 合（或简短格名）
   - scriptExcerpt (string): 对应原文片段
   - shotDescription (string): 本格剧情一句话
   - camera (string, 可选): 景别如「特写」「中景」「全景」
   - durationSec (number): 固定填 0（漫画为静态图）
   - prompt (string): 中文 **生图** 提示词：漫画插画风格、角色外貌、动作、背景、光线；不要包含对白文字
   - negativePrompt (string, 可选): 如「文字、水印、畸形、模糊」

四格叙事：第1格起、第2格承、第3格转、第4格合。角色描述四格保持一致。`;

function resolveStoryboardContext(input: StoryboardGenerateInput): {
    system: string;
    skills: SkillApplyItem[];
    maxShots: number;
    aspectRatio: string;
    taskLabel: string;
} {
    const template = input.template || "default";
    const aspectRatio = input.aspectRatio?.trim() || (template === "four_panel_comic" ? "1:1" : "16:9");

    let skills = (input.skills || []).filter((s) => s.content?.trim());
    let maxShots = input.maxShots ?? 12;
    let system = STORYBOARD_SYSTEM;
    let taskLabel = "视频镜头";

    if (template === "four_panel_comic") {
        system = COMIC_STORYBOARD_SYSTEM;
        maxShots = 4;
        taskLabel = "四格漫画分镜";
        const hasComicBuiltin = skills.some(
            (s) => s.name === FOUR_PANEL_COMIC_SKILL.name || s.content.includes("四格漫画")
        );
        if (!hasComicBuiltin) {
            skills = [builtinToSkillApplyItem(FOUR_PANEL_COMIC_SKILL), ...skills];
        }
    }

    return { system, skills, maxShots: Math.min(30, Math.max(1, maxShots)), aspectRatio, taskLabel };
}

function buildSkillBlock(skills: SkillApplyItem[]): string {
    if (!skills.length) return "";
    return skills
        .map((s) => {
            const tag = isAgentSkillFormat(s.format) ? " [Agent Skill]" : "";
            const desc = s.description ? `\n描述：${s.description}` : "";
            return `### ${s.name || "Skill"}${tag}${desc}\n${s.content.trim()}`;
        })
        .join("\n\n");
}

function extractJsonObject(text: string): unknown {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        // try ```json block
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence?.[1]) {
            try {
                return JSON.parse(fence[1].trim());
            } catch {
                // continue
            }
        }
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(trimmed.slice(start, end + 1));
        }
        throw new Error("无法解析分镜 JSON，请重试");
    }
}

function normalizeShot(raw: unknown, index: number, options?: { allowEmptyPrompt?: boolean }): StoryboardShot {
    if (!raw || typeof raw !== "object") {
        throw new Error(`第 ${index + 1} 个镜头格式无效`);
    }
    const o = raw as Record<string, unknown>;
    const scriptExcerpt = typeof o.scriptExcerpt === "string" ? o.scriptExcerpt.trim() : "";
    const shotDescription =
        typeof o.shotDescription === "string"
            ? o.shotDescription.trim()
            : typeof o.description === "string"
              ? o.description.trim()
              : "";
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";

    if (!shotDescription && !prompt) {
        throw new Error(`第 ${index + 1} 个镜头缺少描述或提示词`);
    }

    const sequence =
        typeof o.sequence === "number" && o.sequence > 0 ? Math.round(o.sequence) : index + 1;
    const durationSec =
        typeof o.durationSec === "number"
            ? o.durationSec === 0
                ? 0
                : Math.min(30, Math.max(1, Math.round(o.durationSec)))
            : 5;

    const shot: StoryboardShot = {
        id: `shot-${sequence}-${Date.now()}-${index}`,
        sequence,
        scriptExcerpt: scriptExcerpt || shotDescription.slice(0, 200),
        shotDescription: shotDescription || prompt.slice(0, 300),
        durationSec,
        prompt: options?.allowEmptyPrompt ? prompt : prompt || shotDescription,
    };

    if (typeof o.title === "string" && o.title.trim()) shot.title = o.title.trim().slice(0, 100);
    if (typeof o.camera === "string" && o.camera.trim()) shot.camera = o.camera.trim().slice(0, 100);
    if (typeof o.negativePrompt === "string" && o.negativePrompt.trim()) {
        shot.negativePrompt = o.negativePrompt.trim().slice(0, 500);
    }

    return shot;
}

function mergePromptsIntoShots(confirmed: StoryboardShot[], generated: StoryboardShot[]): StoryboardShot[] {
    const bySeq = new Map(generated.map((s) => [s.sequence, s]));
    return confirmed.map((base, i) => {
        const gen = bySeq.get(base.sequence) || generated[i];
        if (!gen?.prompt?.trim()) {
            throw new Error(`第 ${base.sequence} 镜未生成有效提示词，请重试`);
        }
        const merged: StoryboardShot = {
            ...base,
            prompt: gen.prompt.trim(),
        };
        const neg = gen.negativePrompt?.trim() || base.negativePrompt;
        if (neg) merged.negativePrompt = neg;
        const cam = gen.camera?.trim() || base.camera;
        if (cam) merged.camera = cam;
        return merged;
    });
}

function finalizeShots(shots: StoryboardShot[], template: StoryboardTemplate): StoryboardShot[] {
    const sorted = [...shots].sort((a, b) => a.sequence - b.sequence);
    sorted.forEach((s, i) => {
        s.sequence = i + 1;
        s.id = `shot-${s.sequence}-${Date.now()}-${i}`;
        if (template === "four_panel_comic") {
            s.durationSec = 0;
        }
    });
    return sorted;
}

function validateComicShotCount(shots: StoryboardShot[], template: StoryboardTemplate) {
    if (template === "four_panel_comic" && shots.length !== 4) {
        throw new Error(`四格漫画需要恰好 4 格，当前得到 ${shots.length} 格，请重试或精简文案`);
    }
}

export class StoryboardService {
    private promptService = new PromptService();

    private async callGeminiStoryboard(
        system: string,
        userMessage: string,
        debugTag: string
    ): Promise<{ shots: unknown[] }> {
        const reply = await this.promptService.chatWithGemini(
            [
                { role: "system", content: system },
                { role: "user", content: userMessage },
            ],
            { temperature: 0.35, maxTokens: 8000, debugTag }
        );

        const parsed = extractJsonObject(reply) as { shots?: unknown[] };
        if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
            throw new Error("模型未返回有效分镜列表");
        }
        return { shots: parsed.shots };
    }

    async generateStoryboard(
        input: StoryboardGenerateInput
    ): Promise<{ shots: StoryboardShot[]; template: StoryboardTemplate; phase: StoryboardPhase }> {
        const script = input.script?.trim();
        if (!script) throw new Error("剧本内容不能为空");
        if (script.length > 50000) throw new Error("剧本内容过长（最多 50000 字）");

        const phase = input.phase || "full";
        const template = input.template || "default";
        const { skills, maxShots, aspectRatio, taskLabel } = resolveStoryboardContext(input);
        const skillBlock = buildSkillBlock(skills);

        if (phase === "split") {
            const system = template === "four_panel_comic" ? SPLIT_COMIC_SYSTEM : SPLIT_STORYBOARD_SYSTEM;
            const userMessage =
                `任务类型：${taskLabel}（仅拆分结构，不写提示词）\n` +
                `画面比例：${aspectRatio}\n` +
                `镜头/格数：${maxShots}\n\n` +
                (skillBlock ? `## 分镜风格 Skill 规则\n${skillBlock}\n\n` : "") +
                `## 用户文案\n${script}\n\n` +
                `请输出 JSON：{"shots":[...]}，prompt 字段全部留空。`;

            const parsed = await this.callGeminiStoryboard(
                system,
                userMessage,
                `storyboard_split_${template}`
            );
            let shots = parsed.shots.slice(0, maxShots).map((item, i) =>
                normalizeShot(item, i, { allowEmptyPrompt: true })
            );
            validateComicShotCount(shots, template);
            return { shots: finalizeShots(shots, template), template, phase };
        }

        if (phase === "prompts") {
            const confirmed = input.shots || [];
            if (!confirmed.length) throw new Error("请先确认分镜结构后再生成提示词");
            validateComicShotCount(confirmed, template);

            const system = template === "four_panel_comic" ? PROMPTS_COMIC_SYSTEM : PROMPTS_STORYBOARD_SYSTEM;
            const shotBrief = confirmed.map((s) => ({
                sequence: s.sequence,
                title: s.title,
                scriptExcerpt: s.scriptExcerpt,
                shotDescription: s.shotDescription,
                camera: s.camera,
                durationSec: s.durationSec,
            }));
            const userMessage =
                `任务类型：${taskLabel}（为已确认分镜撰写提示词）\n` +
                `画面比例：${aspectRatio}\n\n` +
                (skillBlock ? `## 风格 Skill 规则\n${skillBlock}\n\n` : "") +
                `## 原文\n${script}\n\n` +
                `## 已确认分镜\n${JSON.stringify(shotBrief, null, 2)}\n\n` +
                `请为每一镜/格输出完整 prompt，shots 数量必须为 ${confirmed.length}。`;

            const parsed = await this.callGeminiStoryboard(
                system,
                userMessage,
                `storyboard_prompts_${template}`
            );
            const generated = parsed.shots.map((item, i) => normalizeShot(item, i));
            const shots = mergePromptsIntoShots(confirmed, generated);
            validateComicShotCount(shots, template);
            return { shots: finalizeShots(shots, template), template, phase };
        }

        const { system } = resolveStoryboardContext(input);
        const userMessage =
            `任务类型：${taskLabel}\n` +
            `画面比例：${aspectRatio}\n` +
            `镜头/格数上限：${maxShots}\n\n` +
            (skillBlock ? `## 分镜风格 Skill 规则\n${skillBlock}\n\n` : "") +
            `## 用户文案\n${script}\n\n` +
            `请按规则输出 JSON：{"shots":[...]}，shots 数组长度不超过 ${maxShots}。`;

        const parsed = await this.callGeminiStoryboard(
            system,
            userMessage,
            `storyboard_${template}`
        );
        let shots = parsed.shots.slice(0, maxShots).map((item, i) => normalizeShot(item, i));
        validateComicShotCount(shots, template);
        return { shots: finalizeShots(shots, template), template, phase: "full" };
    }
}
