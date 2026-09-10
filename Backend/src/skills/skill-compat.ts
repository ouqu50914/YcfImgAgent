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

    const artnTools = WORKFLOW_TOOL_NAMES.filter((t) => body.includes(t));
    const exportedBy = String(fm["exported-by"] || fm.exported_by || "").trim() || undefined;

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
