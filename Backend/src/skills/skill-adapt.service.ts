/**
 * 用控制模型（Gemini/GPT-6）把市场 Skill 改造成 ARTN 可用说明书，并合并不可适配项
 */
import { createControlModelProvider } from "../services/workflow-agent.service";
import { WORKFLOW_TOOL_NAMES } from "./workflow-agent.tools";
import { CompatGap, CompatGrade, CompatReport, assessSkillCompat } from "./skill-compat";

export type AdaptSkillResult = {
    adapted_body_md: string;
    report: CompatReport;
};

const ADAPT_SYSTEM = `你是 ARTN（YcfImgAgent）Skill 适配器。任务：把外来 SKILL.md 改写成可在 ARTN 上由控制 Agent 执行的说明书。

ARTN 能力边界（必须遵守）：
- 可用工具仅限：${WORKFLOW_TOOL_NAMES.join(", ")}
- 生图/视频必须走画布 Dream/Video 节点；用 propose_generate 请用户确认，禁止声称已自动扣费生成
- 不执行 scripts/、不连接任意 MCP、不访问本机路径/剪映/终端
- 模型映射：Hilo/通用生图→dream 或 gpt-image-2:anyfast；Kling→kling；Seedance→seedance；Pixverse→pixverse；Veo/Wan/Runway 等未接入则写入 gaps 并建议最接近替代
- 节点上已有 generationPrefs（模型/比例/数量/分辨率/时长）必须复用，不要让用户重复确认
- AskUserQuestion / 确认弹窗 → ask_user
- 读 references → list_skill_assets + load_skill_asset（注明路径；若已知缺失则跳过）

输出必须是【纯 JSON】（不要 markdown 围栏），结构：
{
  "adapted_body_md": "完整 Markdown 正文（可含 frontmatter：name/title/description/requires_agent: true）",
  "unadaptable": [ { "code": "string", "message": "中文说明为何无法适配" } ],
  "notes": "给管理员的一句话"
}`;

function extractJson(text: string): any {
    const raw = String(text || "").trim();
    try {
        return JSON.parse(raw);
    } catch {
        /* continue */
    }
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
        try {
            return JSON.parse(fence[1].trim());
        } catch {
            /* continue */
        }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
        return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("模型未返回合法 JSON");
}

function mergeGrade(base: CompatReport, extraBlockers: number): CompatGrade {
    if (base.grade === "C" || extraBlockers > 0) {
        if (base.grade === "A" && extraBlockers === 0) return "A";
        if (extraBlockers >= 2) return "C";
        if (base.grade === "C") return "C";
        return base.gaps.some((g) => g.severity === "blocker") ? "C" : "B";
    }
    if (base.grade === "A" && extraBlockers === 0) return "B"; // 改造后仍标 B 更稳妥？若原本 A 且无新 blocker 保持 A
    return base.grade === "A" ? "A" : "B";
}

export async function adaptSkillWithLlm(input: {
    name: string;
    description: string;
    body_md: string;
    frontmatter?: Record<string, unknown> | null | undefined;
    entry_paths?: string[] | undefined;
    asset_paths?: string[] | undefined;
    staticReport?: CompatReport | undefined;
}): Promise<AdaptSkillResult> {
    const staticReport =
        input.staticReport ||
        assessSkillCompat({
            name: input.name,
            description: input.description,
            body_md: input.body_md,
            frontmatter: input.frontmatter ?? null,
            entry_paths: input.entry_paths ?? [],
            asset_paths: input.asset_paths ?? [],
        });

    const provider = createControlModelProvider();
    const userPayload = {
        name: input.name,
        description: input.description,
        frontmatter: input.frontmatter,
        asset_paths: input.asset_paths || [],
        static_gaps: staticReport.gaps,
        body_md: input.body_md.slice(0, 14000),
    };

    const result = await provider.chatWithTools(
        [
            { role: "system", content: ADAPT_SYSTEM },
            {
                role: "user",
                content:
                    "请改造以下 Skill，并列出仍然无法适配的点：\n" +
                    JSON.stringify(userPayload).slice(0, 16000),
            },
        ],
        [] as any
    );

    const parsed = extractJson(result.text || "");
    const adapted = String(parsed.adapted_body_md || "").trim();
    if (!adapted || adapted.length < 40) {
        throw new Error("改造结果正文过短或为空");
    }

    const unadaptable = Array.isArray(parsed.unadaptable) ? parsed.unadaptable : [];
    const llmGaps: CompatGap[] = unadaptable.map((u: any, i: number) => ({
        code: String(u?.code || `llm_gap_${i + 1}`),
        severity: "major" as const,
        message: String(u?.message || u || "无法适配"),
        remediable: false,
    }));

    // 静态 blocker 保留；可改造项若已改造可降为 minor 说明
    const retained = staticReport.gaps.map((g) => {
        if (g.remediable && g.code === "market_prose_only") {
            return { ...g, severity: "minor" as const, message: g.message + "（已生成适配版）" };
        }
        return g;
    });

    const gaps = [...retained];
    for (const g of llmGaps) {
        if (!gaps.some((x) => x.message === g.message || x.code === g.code)) gaps.push(g);
    }

    const blockers = gaps.filter((g) => g.severity === "blocker").length;
    let grade = staticReport.grade;
    if (blockers > 0) grade = "C";
    else if (gaps.some((g) => g.severity === "major")) grade = "B";
    else grade = staticReport.grade === "C" ? "B" : staticReport.grade;

    // 有适配正文且无 blocker → 至少 B
    if (blockers === 0 && grade === "C") grade = "B";
    if (blockers === 0 && staticReport.grade === "A" && llmGaps.length === 0) grade = "A";

    const report: CompatReport = {
        ...staticReport,
        grade,
        grade_label: grade === "A" ? "可完整适配" : grade === "B" ? "改造后部分可用" : "仅存档 / 难适配",
        summary:
            (typeof parsed.notes === "string" && parsed.notes.trim()) ||
            (grade === "A"
                ? "已生成 ARTN 适配版，可直接用 Agent 执行"
                : grade === "B"
                  ? "已生成 ARTN 适配版；请查看不可适配项后再用"
                  : "缺口较大，适配版仅供参考"),
        gaps,
        adapted: true,
        adapted_at: new Date().toISOString(),
        assessed_at: new Date().toISOString(),
    };

    void mergeGrade;
    return { adapted_body_md: adapted, report };
}
