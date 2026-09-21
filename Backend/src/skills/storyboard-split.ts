/**
 * 受控脚本：分镜规划（建议镜数+角色一致性摘要）与拆镜（每镜独立短提示词）。
 */
import axios from "axios";

export type StoryboardPanelPrompt = {
    index: number;
    promptText: string;
};

type GptCreds = {
    apiKey: string;
    apiUrl: string;
    model: string;
};

function getGptCreds(): GptCreds | null {
    const apiKey =
        process.env.WORKFLOW_AGENT_GPT6_API_KEY ||
        process.env.API_KEY ||
        process.env.ACE_API_KEY ||
        process.env.GEMINI_CHAT_API_KEY;
    if (!apiKey) return null;
    const API_BASE = (
        process.env.WORKFLOW_AGENT_GPT6_API_BASE ||
        process.env.API_BASE ||
        process.env.QC_API_BASE ||
        "https://api.acedata.cloud/v1"
    ).replace(/\/$/, "");
    const apiUrl = /\/chat\/completions/i.test(API_BASE) ? API_BASE : `${API_BASE}/chat/completions`;
    const model = (process.env.WORKFLOW_AGENT_GPT6_MODEL || "gpt-6-astra").trim();
    return { apiKey, apiUrl, model };
}

function clampPanels(n: number): number {
    return Math.max(1, Math.min(8, Math.floor(n) || 1));
}

function resolveExplicitPanelCount(input: Record<string, unknown>): number | null {
    const panelsArg = Number(input.panels);
    if (Number.isFinite(panelsArg) && panelsArg >= 1) return clampPanels(panelsArg);
    const rows = Number(input.rows);
    const cols = Number(input.cols);
    if (Number.isFinite(rows) && rows >= 1 && Number.isFinite(cols) && cols >= 1) {
        return clampPanels(rows * cols);
    }
    return null;
}

/** 从全文抽出可复用的参考图别名 */
export function extractAliasTail(story: string): string {
    const s = String(story || "");
    const aliases = Array.from(s.matchAll(/(?:@)?((?:图|视频|音频)\d+)/g)).map((m) => m[1]);
    const uniq = Array.from(new Set(aliases));
    if (!uniq.length) return "";
    return `身份锚点参考 ${uniq.map((a) => `@${a}`).join(" ")}：五官/发型/服装/配饰必须与参考图完全一致（must strictly match reference）。`;
}

/**
 * 角色锁定块（对齐原市场 Skill：先档案锁定，再分镜；每镜强制复用）。
 * 禁止跨镜换帽、换外套、改发色等外观漂移。
 */
export function buildConsistencyBlock(characterBrief: string, story: string): string {
    const brief = String(characterBrief || "").trim();
    const alias = extractAliasTail(story);
    const lockBody =
        brief ||
        "各主要角色：发型发色、五官、眼镜、帽子（有则始终戴、无则始终不戴）、上衣/外套颜色款式、配饰、体型——全片完全一致。";
    return (
        `【角色锁定·全片强制·最高优先级】${lockBody}` +
        ` 硬性禁止：增减帽子/眼镜/配饰、更换外套或上衣颜色款式、改发型发色、改五官体型。` +
        ` 本镜只允许变化：景别、动作、表情、姿态、镜头构图与对话气泡；外观必须与锁定描述及参考图逐项一致。` +
        (alias ? ` ${alias}` : "")
    );
}

function wrapPanelPrompt(
    index: number,
    total: number,
    beat: string,
    consistencyBlock: string
): string {
    const body = String(beat || "").trim() || `表现第 ${index} 个情节节拍`;
    // 去掉 beat 里可能诱发换装的弱表述（仍保留剧情动作）
    const cleanedBeat = body
        .replace(/换上|换装|脱掉外套|摘掉帽子|戴上帽子|换了件/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    const cons = String(consistencyBlock || "").trim();
    return (
        `【仅第 ${index}/${total} 镜·单镜头全幅成品图】` +
        `本张只画这一个镜头，禁止多格/竖条分镜/宫格拼版/三视图/标题条/格号。` +
        (cons ? `${cons} ` : "") +
        `【本镜画面·不得改服装配饰】${cleanedBeat || body}`
    );
}

function heuristicSuggestPanels(story: string): number {
    const parts = String(story || "")
        .split(/(?<=[。！？；\n])|(?<=[.!?]\s)/)
        .map((x) => x.trim())
        .filter(Boolean);
    if (parts.length <= 1) return 2;
    if (parts.length === 2) return 2;
    if (parts.length === 3) return 3;
    if (parts.length <= 5) return 4;
    if (parts.length <= 7) return 6;
    return 8;
}

export function splitStoryHeuristic(
    story: string,
    total: number,
    consistencyBlock: string
): StoryboardPanelPrompt[] {
    const raw = String(story || "").trim();
    const cleaned = raw
        .replace(/(?:@)?(?:图|视频|音频)\d+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const parts = cleaned
        .split(/(?<=[。！？；\n])|(?<=[.!?]\s)/)
        .map((x) => x.trim())
        .filter(Boolean);

    const beats: string[] = [];
    if (parts.length === 0) {
        for (let i = 0; i < total; i++) beats.push(`第 ${i + 1} 个情节节拍（根据用户剧情）`);
    } else if (parts.length >= total) {
        for (let i = 0; i < total; i++) {
            const start = Math.floor((i * parts.length) / total);
            const end = Math.floor(((i + 1) * parts.length) / total);
            beats.push(parts.slice(start, Math.max(start + 1, end)).join(""));
        }
    } else {
        for (let i = 0; i < total; i++) {
            beats.push(parts[Math.min(i, parts.length - 1)] || parts[0]!);
        }
    }

    return beats.map((beat, i) => ({
        index: i + 1,
        promptText: wrapPanelPrompt(i + 1, total, beat, consistencyBlock),
    }));
}

async function chatJson(creds: GptCreds, system: string, user: string): Promise<any> {
    const resp = await axios.post(
        creds.apiUrl,
        {
            model: creds.model,
            temperature: 0.3,
            max_tokens: 2200,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        },
        {
            headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
            timeout: Number(process.env.STORYBOARD_SPLIT_TIMEOUT_MS || "60000"),
        }
    );
    let text = String(resp.data?.choices?.[0]?.message?.content || "").trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(text);
}

async function planWithGpt6(
    story: string
): Promise<{ suggestedPanels: number; characterBrief: string } | null> {
    const creds = getGptCreds();
    if (!creds) return null;
    try {
        const parsed = await chatJson(
            creds,
            "你做分镜规划，并产出「角色锁定档案」（对齐前期设定 brief）。只返回 JSON，不要 markdown。" +
                '格式：{"suggestedPanels":数字,"characterBrief":"多行或长句的角色锁定档案"}。' +
                "suggestedPanels 在 2～8 之间，按情节节拍数量建议，不要为了凑宫格硬凑。" +
                "characterBrief 必须按角色逐个写清锁定项（缺一不可）：姓名或角色A/B、性别年龄段、发型发色、五官特征（眼镜等）、" +
                "帽子（明确：戴什么颜色/款式的帽子，或明确写「不戴帽子」）、上衣与外套的颜色款式、配饰、体型、画风。" +
                "这些外观全片强制一致；若剧情未写换装，禁止暗示换装。若文中有 @图N，写明必须与参考图一致。",
            `剧情：\n${story}`
        );
        const suggestedPanels = clampPanels(Number(parsed?.suggestedPanels) || heuristicSuggestPanels(story));
        const characterBrief = String(parsed?.characterBrief || "").trim();
        if (!characterBrief) return null;
        return { suggestedPanels, characterBrief };
    } catch {
        return null;
    }
}

async function splitStoryWithGpt6(
    story: string,
    total: number,
    consistencyBlock: string
): Promise<StoryboardPanelPrompt[] | null> {
    const creds = getGptCreds();
    if (!creds) return null;
    try {
        const parsed = await chatJson(
            creds,
            "你把一段剧情拆成生图用的分镜提示词。只返回 JSON，不要 markdown。" +
                '格式：{"panels":[{"index":1,"beat":"..."},...]}。' +
                "每条 beat 只描述【一个】镜头：景别 + 人物动作/表情 + 场景/光影，不要重复整段故事，不要写多格漫画。" +
                `必须正好 ${total} 条，index 从 1 到 ${total}。简体中文。` +
                "严禁在 beat 里改写或重述服装/帽子/发型/配饰（这些已由角色锁定块固定）；" +
                "严禁写摘帽、戴帽、换外套、换装等外观变化，除非用户剧情原文明确要求换装。" +
                "beat 只写动作与构图，例如「中景，女主皱眉指向男主，厨房暖光」。",
            `角色锁定（必须遵守，勿写入 beat 以免冲突）：\n${consistencyBlock}\n\n请拆成 ${total} 镜：\n${story}`
        );
        const arr = Array.isArray(parsed?.panels) ? parsed.panels : [];
        if (arr.length < total) return null;
        const out: StoryboardPanelPrompt[] = [];
        for (let i = 0; i < total; i++) {
            const beat = String(arr[i]?.beat || arr[i]?.promptText || "").trim();
            if (!beat) return null;
            out.push({ index: i + 1, promptText: wrapPanelPrompt(i + 1, total, beat, consistencyBlock) });
        }
        return out;
    } catch {
        return null;
    }
}

/**
 * phase=plan（默认，当未确认镜数时）：只返回建议镜数 + 角色一致性草稿，供 ask_user
 * phase=split：必须带 panels（已确认）与 characterBrief（已确认），返回每镜独立提示词
 */
export async function buildStoryboardPanelSplitResult(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const story = String(input.story || input.prompt || input.text || "").trim();
    const phaseRaw = String(input.phase || "").trim().toLowerCase();
    const explicitPanels = resolveExplicitPanelCount(input);
    const characterBriefIn = String(input.characterBrief || input.character_brief || "").trim();
    const confirmed =
        input.confirmed === true ||
        input.confirmed === "true" ||
        input.userConfirmed === true ||
        phaseRaw === "split";

    // —— 规划阶段：未确认镜数时，不拆镜、不建节点 ——
    const wantPlan =
        phaseRaw === "plan" || (!confirmed && explicitPanels == null) || (phaseRaw !== "split" && !confirmed);

    if (wantPlan && phaseRaw !== "split") {
        let suggestedPanels = heuristicSuggestPanels(story || "……");
        let characterBrief =
            characterBriefIn ||
            "女主/男主：发型发色、眼镜、帽子（明确戴或不戴及款式颜色）、上衣与外套颜色款式、配饰、体型全片锁定；画风统一；与参考图一致。";
        if (story) {
            const planned = await planWithGpt6(story);
            if (planned) {
                suggestedPanels = planned.suggestedPanels;
                if (!characterBriefIn) characterBrief = planned.characterBrief;
            }
        }
        return {
            mode: "plan",
            needUserConfirm: true,
            suggestedPanels,
            characterBrief,
            storyPresent: Boolean(story),
            panelPrompts: [],
            agentHint:
                "先 ask_user 展示完整 characterBrief（角色锁定档案：发型/眼镜/帽子有无与款式颜色/外套上衣/配饰/体型），请用户核对修改；" +
                "同时确认 panels。用户确认后再 phase=split，传入 panels、characterBrief、story。" +
                "拆镜后每镜 create_image_pipeline 必须带 referenceNodeIds（角色参考图），presentation=images_only。",
        };
    }

    // —— 拆镜阶段 ——
    if (!characterBriefIn) {
        return {
            mode: "plan",
            needUserConfirm: true,
            error: "characterBrief_required",
            suggestedPanels: explicitPanels ?? 4,
            characterBrief: "",
            panelPrompts: [],
            agentHint:
                "缺少已确认的 characterBrief。请先 phase=plan，ask_user 确认角色锁定档案后再 split。",
        };
    }

    const total = explicitPanels ?? clampPanels(Number(input.suggestedPanels) || 4);
    const consistencyBlock = buildConsistencyBlock(characterBriefIn, story);
    let panelPrompts: StoryboardPanelPrompt[] | null = null;
    let splitSource: "gpt6" | "heuristic" | "template" = "template";

    if (story) {
        panelPrompts = await splitStoryWithGpt6(story, total, consistencyBlock);
        if (panelPrompts) splitSource = "gpt6";
        if (!panelPrompts) {
            panelPrompts = splitStoryHeuristic(story, total, consistencyBlock);
            splitSource = "heuristic";
        }
    } else {
        panelPrompts = Array.from({ length: total }, (_, i) => ({
            index: i + 1,
            promptText: wrapPanelPrompt(
                i + 1,
                total,
                `第 ${i + 1} 个情节节拍（请向用户确认具体画面）`,
                consistencyBlock
            ),
        }));
        splitSource = "template";
    }

    const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    const rows = Math.max(1, Math.ceil(total / cols));

    return {
        mode: "per_panel_separate_prompts",
        needUserConfirm: false,
        rows,
        cols,
        panels: total,
        characterBrief: characterBriefIn || consistencyBlock,
        consistencyBlock,
        numImagesPerPanel: 1,
        splitSource,
        panelPrompts,
        agentHint:
            "为 panelPrompts 每一项 create_image_pipeline(presentation=images_only, promptText, numImages=1, 必须带 referenceNodeIds=角色参考图, 复用模型比例)，再用 jobId propose_generate；" +
            "promptText 已含【角色锁定】，禁止再改写服装帽子；确认后写入分镜集合节点。",
    };
}
