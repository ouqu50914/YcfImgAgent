/**
 * Skill 静态适配体检与评级（规则层；LLM 改造见 skill-adapt.service）
 */
import { detectExecutableScripts, detectHasScripts } from "./parse-skill-md";
import { WORKFLOW_TOOL_NAMES } from "./workflow-agent.tools";

export type CompatGrade = "A" | "B" | "C";

export type CompatGap = {
    code: string;
    severity: "blocker" | "major" | "minor";
    message: string;
    /** 是否可通过 LLM 改造缓解（仍可能无法消除平台能力缺口） */
    remediable: boolean;
};

export type CompatReport = {
    grade: CompatGrade;
    grade_label: string;
    summary: string;
    gaps: CompatGap[];
    /** 静态发现的能力需求 */
    signals: {
        has_scripts: boolean;
        has_executable_scripts: boolean;
        has_hub_gui: boolean;
        has_references: boolean;
        missing_reference_paths: string[];
        mentions_mcp: boolean;
        mentions_foreign_models: string[];
        mentions_artn_tools: string[];
        exported_by?: string | undefined;
    };
    assessed_at: string;
    adapted?: boolean;
    adapted_at?: string;
};

const FOREIGN_MODELS = [
    "hilo",
    "veo",
    "veo3",
    "wan",
    "runway",
    "luma",
    "sora",
    "hailuo",
    "minimax",
];

const ARTN_MODEL_HINTS = ["kling", "seedance", "pixverse", "seedream", "dream", "midjourney", "gpt-image", "nano"];

function gradeLabel(g: CompatGrade): string {
    if (g === "A") return "可完整适配";
    if (g === "B") return "改造后部分可用";
    return "仅存档 / 难适配";
}

/** 从正文提取 references/ 路径引用 */
export function extractReferencedPaths(body: string): string[] {
    const out = new Set<string>();
    const re = /(?:references|assets)\/[A-Za-z0-9_./\-]+\.(?:md|txt|json|csv|ya?ml)/gi;
    for (const m of body.matchAll(re)) {
        out.add(m[0].replace(/\\/g, "/"));
    }
    return [...out];
}

export function assessSkillCompat(input: {
    name: string;
    description?: string;
    body_md: string;
    frontmatter?: Record<string, unknown> | null | undefined;
    entry_paths?: string[] | undefined;
    asset_paths?: string[] | undefined;
}): CompatReport {
    const paths = (input.entry_paths || []).map((p) => p.replace(/\\/g, "/"));
    const assets = new Set((input.asset_paths || []).map((p) => p.replace(/\\/g, "/")));
    const body = input.body_md || "";
    const fm = input.frontmatter || {};
    const blob = `${input.description || ""}\n${body}\n${JSON.stringify(fm)}`.toLowerCase();

    const hasScripts = detectHasScripts(paths);
    const hasExecutable = detectExecutableScripts(paths);
    const hasHubGui = hasScripts && !hasExecutable;
    const refPaths = paths.filter((p) => {
        const rel = p.includes("/") ? p.replace(/^[^/]+\//, "") : p;
        return /^(references|assets)\//i.test(rel);
    });
    const hasReferences = refPaths.length > 0 || assets.size > 0;

    const referenced = extractReferencedPaths(body);
    const missing = referenced.filter((r) => {
        if (assets.has(r)) return false;
        return !paths.some((p) => p.endsWith(r) || p.includes(`/${r}`));
    });

    const mentionsMcp = /\bmcp\b|model context protocol/i.test(blob);
    const foreign: string[] = [];
    for (const m of FOREIGN_MODELS) {
        if (blob.includes(m) && !ARTN_MODEL_HINTS.some((a) => m.includes(a))) {
            // 避免 minimax 仅作为 exported-by 噪声时也记——仍记，改造时要映射
            foreign.push(m);
        }
    }
    const uniqForeign = [...new Set(foreign)];

    const artnTools: string[] = WORKFLOW_TOOL_NAMES.filter((t) => body.includes(t));
    const exportedBy = String(fm["exported-by"] || fm.exported_by || "").trim() || undefined;
    const artnMeta = extractArtnCompat(fm);
    if (artnMeta?.tools?.length) {
        const known = new Set<string>(WORKFLOW_TOOL_NAMES as unknown as string[]);
        for (const t of artnMeta.tools) {
            if (known.has(t) && !artnTools.includes(t)) {
                artnTools.push(t);
            }
        }
    }

    const gaps: CompatGap[] = [];

    if (hasExecutable) {
        gaps.push({
            code: "executable_scripts",
            severity: "blocker",
            message: "包含可执行 scripts（py/sh 等），ARTN 不会执行；相关步骤无法原样复现",
            remediable: false,
        });
    } else if (hasHubGui) {
        gaps.push({
            code: "hub_gui_scripts",
            severity: "major",
            message: "包含 Hub GUI（scripts/*.js），ARTN 忽略界面，改由对话 Agent + 画布节点完成",
            remediable: true,
        });
    }

    if (mentionsMcp) {
        gaps.push({
            code: "mcp_required",
            severity: "major",
            message: "正文提及 MCP；需平台启用对应 MCP 服务器后才可能补齐（当前默认未开放任意 MCP）",
            remediable: false,
        });
    }

    if (missing.length) {
        gaps.push({
            code: "missing_references",
            severity: "major",
            message: `正文引用但包内缺失的附件：${missing.slice(0, 8).join("、")}${missing.length > 8 ? "…" : ""}`,
            remediable: true,
        });
    }

    if (uniqForeign.length) {
        gaps.push({
            code: "foreign_models",
            severity: "major",
            message: `提到 ARTN 可能未接入的模型/平台：${uniqForeign.join("、")}，需映射到 Seedream/Kling/Seedance/Pixverse 等`,
            remediable: true,
        });
    }

    if (exportedBy && /minimax|hub/i.test(exportedBy) && artnTools.length === 0) {
        gaps.push({
            code: "market_prose_only",
            severity: "minor",
            message: "市场包未使用 ARTN 工具名，需 LLM 改造成 ask_user / create_*_pipeline / propose_generate 流程",
            remediable: true,
        });
    }

    if (/\b(剪映|本地路径|bash|terminal|sudo)\b/i.test(body)) {
        gaps.push({
            code: "local_side_effects",
            severity: "blocker",
            message: "依赖本机副作用（剪映/终端/本地路径等），ARTN 无法适配",
            remediable: false,
        });
    }

    const blockers = gaps.filter((g) => g.severity === "blocker");
    const majors = gaps.filter((g) => g.severity === "major");

    let grade: CompatGrade = "A";
    if (blockers.length >= 1 && majors.length >= 1) grade = "C";
    else if (blockers.length >= 1) grade = "C";
    else if (majors.length >= 2) grade = "B";
    else if (majors.length === 1 || gaps.some((g) => g.remediable)) grade = "B";
    else if (artnTools.length > 0 && !exportedBy) grade = "A";
    else if (gaps.length === 0) grade = "A";
    else grade = "B";

    // 纯 ARTN 系统 skill
    if (artnTools.length >= 2 && !hasExecutable && !mentionsMcp) {
        grade = "A";
    }

    const summary =
        grade === "A"
            ? "流程可直接落在 ARTN 画布工具上，建议用 Agent 执行"
            : grade === "B"
              ? "建议一键生成 ARTN 适配版后再用；部分能力需降级或跳过"
              : "存在无法消除的平台缺口，仅建议存档或人工精简后使用";

    return {
        grade,
        grade_label: gradeLabel(grade),
        summary,
        gaps,
        signals: {
            has_scripts: hasScripts,
            has_executable_scripts: hasExecutable,
            has_hub_gui: hasHubGui,
            has_references: hasReferences,
            missing_reference_paths: missing,
            mentions_mcp: mentionsMcp,
            mentions_foreign_models: uniqForeign,
            mentions_artn_tools: artnTools,
            ...(exportedBy ? { exported_by: exportedBy } : {}),
        },
        assessed_at: new Date().toISOString(),
    };
}

/** 外源模型 → ARTN 建议映射（规则补丁用） */
export const FOREIGN_MODEL_MAP: Record<string, { artn: string; note: string }> = {
    hilo: { artn: "dream 或 gpt-image-2:anyfast", note: "通用生图" },
    veo: { artn: "kling / seedance（最接近视频能力）", note: "未接入 Veo" },
    veo3: { artn: "kling / seedance", note: "未接入 Veo3" },
    wan: { artn: "kling / seedance", note: "未接入 Wan" },
    runway: { artn: "kling / seedance / pixverse", note: "未接入 Runway" },
    luma: { artn: "kling / seedance", note: "未接入 Luma" },
    sora: { artn: "kling / seedance", note: "未接入 Sora" },
    hailuo: { artn: "kling / seedance", note: "未接入海螺" },
    minimax: { artn: "按任务选 dream / kling / seedance", note: "平台名，非单一模型" },
};

export type ArtnCompatMeta = {
    requires_agent?: boolean;
    tools?: string[];
    model_map?: Record<string, string>;
    layout?: string;
};

/** 读取 frontmatter.artn 兼容契约（若有） */
export function extractArtnCompat(frontmatter?: Record<string, unknown> | null): ArtnCompatMeta | null {
    if (!frontmatter || typeof frontmatter !== "object") return null;
    const raw = frontmatter.artn;
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const tools = Array.isArray(o.tools) ? o.tools.map(String) : undefined;
    const model_map =
        o.model_map && typeof o.model_map === "object"
            ? Object.fromEntries(
                  Object.entries(o.model_map as Record<string, unknown>).map(([k, v]) => [k, String(v)])
              )
            : undefined;
    return {
        requires_agent: o.requires_agent === true || o.requires_agent === "true",
        ...(tools ? { tools } : {}),
        ...(model_map ? { model_map } : {}),
        ...(typeof o.layout === "string" && o.layout ? { layout: o.layout } : {}),
    };
}

/**
 * Agent 是否可选：
 * - C：不可选（仅存档）
 * - B：须已有适配版
 * - A：可选
 * - unsupported status 由列表侧另行过滤
 */
export function isAgentSelectable(grade: CompatGrade | string | null | undefined, hasAdapted: boolean): boolean {
    const g = String(grade || "").toUpperCase();
    if (g === "C") return false;
    if (g === "B") return Boolean(hasAdapted);
    if (g === "A") return true;
    // 未知评级：有适配版才放行更稳妥
    return Boolean(hasAdapted);
}

/** 缺口驱动的规则补丁正文（不依赖 LLM；可作适配底稿或 LLM 失败回退） */
export function buildRuleBasedAdaptedBody(input: {
    name: string;
    description: string;
    body_md: string;
    frontmatter?: Record<string, unknown> | null;
    report: CompatReport;
}): string {
    const artn = extractArtnCompat(input.frontmatter);
    const foreign = input.report.signals.mentions_foreign_models || [];
    const mapLines = foreign.map((m) => {
        const hit = FOREIGN_MODEL_MAP[m.toLowerCase()];
        return hit ? `- ${m} → ${hit.artn}（${hit.note}）` : `- ${m} → 选用最接近的已接入模型，并 ask_user 确认`;
    });
    const missing = input.report.signals.missing_reference_paths || [];
    const title =
        String(input.frontmatter?.title || input.frontmatter?.display_name || "").trim() || input.name;

    const parts: string[] = [
        "---",
        `name: ${input.name}`,
        `title: ${title}`,
        `description: ${JSON.stringify(input.description).slice(1, -1)}`,
        "requires_agent: true",
        "artn:",
        "  adapted: true",
        "  adapt_source: rule_patch",
        "  tools:",
        "    - get_workflow_snapshot",
        "    - ask_user",
        "    - configure_node",
        "    - create_image_pipeline",
        "    - create_video_pipeline",
        "    - propose_generate",
        "    - list_skill_assets",
        "    - load_skill_asset",
        "---",
        "",
        `# ${title}（ARTN 适配版）`,
        "",
        "> 本说明由规则补丁生成：不执行 scripts、不接任意 MCP；生图/视频须 propose_generate 挂起，由用户点「确认并生成」后才扣费；禁止连环重试。",
        "",
        "## 执行流程（必须遵守）",
        "1. `get_workflow_snapshot` 了解画布与已选节点",
        "2. 缺角色参考图 / 风格 / 剧情等关键信息时 `ask_user`；疑问句只回答不要直接生成",
        "3. 需要模板时 `list_skill_assets` + `load_skill_asset`（缺失文件则跳过并说明）",
        "4. 优先 `configure_node` 更新已有 Dream/Video；必要时 `create_image_pipeline` / `create_video_pipeline`",
        "5. `propose_generate` 挂起待确认——禁止未授权就声称已生成，禁止自检失败连环重试",
        "",
    ];

    if (mapLines.length) {
        parts.push("## 模型映射", ...mapLines, "");
    }
    if (artn?.model_map && Object.keys(artn.model_map).length) {
        parts.push(
            "## Skill 自带 model_map",
            ...Object.entries(artn.model_map).map(([k, v]) => `- ${k} → ${v}`),
            ""
        );
    }
    if (artn?.layout) {
        parts.push(`## 版式约束`, `- layout: ${artn.layout}`, "");
    }
    if (input.report.signals.has_hub_gui) {
        parts.push(
            "## Hub GUI",
            "- 原包含 scripts/*.js 界面，ARTN **忽略**；用对话 + 画布节点完成同等目标。",
            ""
        );
    }
    if (missing.length) {
        parts.push(
            "## 缺失附件（跳过）",
            ...missing.slice(0, 12).map((p) => `- ${p}`),
            ""
        );
    }
    const blockers = input.report.gaps.filter((g) => g.severity === "blocker");
    if (blockers.length) {
        parts.push("## 不可适配项", ...blockers.map((g) => `- [${g.code}] ${g.message}`), "");
    }

    const clipped = String(input.body_md || "").trim();
    const bodyClip = clipped.length > 6000 ? clipped.slice(0, 6000) + "\n…" : clipped;
    parts.push("## 原 Skill 要点（供参考，流程以上方 ARTN 步骤为准）", "", bodyClip);

    return parts.join("\n");
}
