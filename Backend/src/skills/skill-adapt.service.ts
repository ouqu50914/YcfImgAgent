/**
 * Skill 适配：规则补丁 +（可选）控制模型改造；合并不可适配项
 */
import { createControlModelProvider } from "../services/workflow-agent.service";
import { WORKFLOW_TOOL_NAMES } from "./workflow-agent.tools";
import {
    CompatGap,
    CompatReport,
    assessSkillCompat,
    buildRuleBasedAdaptedBody,
    isAgentSelectable,
} from "./skill-compat";

export type AdaptSkillResult = {
    adapted_body_md: string;
    report: CompatReport;
    /** rule_only | llm | rule_then_llm */
    adapt_mode: "rule_only" | "llm" | "rule_then_llm";
};

const ADAPT_SYSTEM = `你是 ARTN（YcfImgAgent）Skill 适配器。任务：把外来 SKILL.md 改写成可在 ARTN 上由控制 Agent 执行的说明书。

ARTN 能力边界（必须遵守）：
- 可用工具仅限：${WORKFLOW_TOOL_NAMES.join(", ")}
- 生图/视频必须走画布 Dream/Video 节点；搭好后 propose_generate 仅挂起，等用户点「确认并生成」才扣费；授权回合内可继续建节点并自动生成但有额度上限；疑问句禁止 propose；禁止连环重试；禁止在任务未完成时声称已出图成功
- 不执行 scripts/、不连接任意 MCP、不访问本机路径/剪映/终端
- 模型映射：Hilo/通用生图→dream 或 gpt-image-2:anyfast；Kling→kling；Seedance→seedance；Pixverse→pixverse；Veo/Wan/Runway 等未接入则写入 gaps 并建议最接近替代
- 分镜/故事板类：改写为「一镜一图」多张独立成品图（numImages=镜数），禁止一张宫格整图拼版，禁止三视图/设定板/标题条等多余信息
- 节点上已有 generationPrefs（模型/比例/数量/分辨率/时长）必须复用，不要让用户重复确认
- AskUserQuestion / 确认弹窗 → ask_user
- 读 references → list_skill_assets + load_skill_asset（注明路径；若已知缺失则跳过）
- 可参考用户消息里的 rule_patch_draft，在其基础上润色，不要删掉 ARTN 执行流程五步

输出必须是【纯 JSON】（不要 markdown 围栏），结构：
{
  "adapted_body_md": "完整 Markdown 正文（可含 frontmatter：name/title/description/requires_agent: true 与 artn 段）",
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

function finalizeReport(
    staticReport: CompatReport,
    llmGaps: CompatGap[],
    notes: string,
    adapted: boolean
): CompatReport {
    const retained = staticReport.gaps.map((g) => {
        if (g.remediable && (g.code === "market_prose_only" || g.code === "hub_gui_scripts" || g.code === "foreign_models")) {
            return {
                ...g,
                severity: "minor" as const,
                message: g.message + (adapted ? "（已写入适配版）" : ""),
            };
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
    else if (staticReport.grade === "C" && adapted) grade = "B";
    else if (staticReport.grade === "A" && llmGaps.length === 0) grade = "A";
    else if (adapted && blockers === 0) grade = staticReport.grade === "A" ? "A" : "B";

    return {
        ...staticReport,
        grade,
        grade_label: grade === "A" ? "可完整适配" : grade === "B" ? "改造后部分可用" : "仅存档 / 难适配",
        summary:
            notes ||
            (grade === "A"
                ? "已生成 ARTN 适配版，可直接用 Agent 执行"
                : grade === "B"
                  ? "已生成 ARTN 适配版；请查看不可适配项后再用"
                  : "缺口较大，仅建议存档"),
        gaps,
        adapted,
        adapted_at: new Date().toISOString(),
        assessed_at: new Date().toISOString(),
    };
}

export type AdaptSkillOptions = {
    /** 上传自动适配：优先规则补丁，LLM 失败不抛错 */
    preferRuleOnFailure?: boolean;
    /** 跳过 LLM，仅规则补丁（更快） */
    ruleOnly?: boolean;
};

/**
 * 适配入口：
 * - C 级：只写规则存档说明（仍生成 adapted 底稿便于人工改），但 isAgentSelectable 仍为 false
 * - B/A：规则补丁 + 可选 LLM 润色
 */
export async function adaptSkillWithLlm(
    input: {
        name: string;
        description: string;
        body_md: string;
        frontmatter?: Record<string, unknown> | null | undefined;
        entry_paths?: string[] | undefined;
        asset_paths?: string[] | undefined;
        staticReport?: CompatReport | undefined;
    },
    opts?: AdaptSkillOptions
): Promise<AdaptSkillResult> {
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

    const ruleBody = buildRuleBasedAdaptedBody({
        name: input.name,
        description: input.description,
        body_md: input.body_md,
        frontmatter: input.frontmatter ?? null,
        report: staticReport,
    });

    // C 或明确只要规则：不调用 LLM
    if (opts?.ruleOnly || staticReport.grade === "C") {
        const report = finalizeReport(
            staticReport,
            staticReport.grade === "C"
                ? [
                      {
                          code: "grade_c_archive",
                          severity: "blocker",
                          message: "评为 C 级：Agent 不可选用，仅存档；可人工精简后重新适配",
                          remediable: false,
                      },
                  ]
                : [],
            staticReport.grade === "C" ? "C 级已生成规则底稿，不可直接进 Agent" : "已用规则补丁生成适配版",
            true
        );
        // C 保持 C
        if (staticReport.grade === "C") {
            report.grade = "C";
            report.grade_label = "仅存档 / 难适配";
        }
        return {
            adapted_body_md: ruleBody,
            report,
            adapt_mode: "rule_only",
        };
    }

    try {
        const provider = createControlModelProvider();
        const userPayload = {
            name: input.name,
            description: input.description,
            frontmatter: input.frontmatter,
            asset_paths: input.asset_paths || [],
            static_gaps: staticReport.gaps,
            rule_patch_draft: ruleBody.slice(0, 8000),
            body_md: input.body_md.slice(0, 10000),
        };

        const result = await provider.chatWithTools(
            [
                { role: "system", content: ADAPT_SYSTEM },
                {
                    role: "user",
                    content:
                        "请在规则补丁草稿基础上改造以下 Skill，并列出仍然无法适配的点：\n" +
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

        const notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
        const report = finalizeReport(staticReport, llmGaps, notes, true);
        return { adapted_body_md: adapted, report, adapt_mode: "rule_then_llm" };
    } catch (e) {
        if (opts?.preferRuleOnFailure !== false) {
            const report = finalizeReport(
                staticReport,
                [
                    {
                        code: "llm_adapt_fallback",
                        severity: "minor",
                        message: `LLM 适配失败，已回退规则补丁：${(e as Error)?.message || e}`,
                        remediable: true,
                    },
                ],
                "LLM 失败，已使用规则补丁适配版",
                true
            );
            return { adapted_body_md: ruleBody, report, adapt_mode: "rule_only" };
        }
        throw e;
    }
}

export { isAgentSelectable };
