/**
 * 受控脚本白名单脚手架（默认关闭）。
 *
 * 环境变量：
 * - CONTROLLED_SCRIPTS_ENABLED=false 可关闭（默认开启进程内白名单）
 * - CONTROLLED_SCRIPTS_JSON=["storyboard_grid_hint","prompt_budget_clip"]  （可选：仅启用列出的 id）
 *
 * 安全原则（硬约束）：
 * - 永不执行用户/市场 Skill 包内 scripts
 * - 注册表不含 command/cwd；实现只能映射到仓库内 handlerKey
 * - 真实执行见后续 run_controlled_script；本文件先提供发现与状态
 *
 * 设计文档：docs-obsidian/08-受控脚本白名单设计.md
 */

import { buildStoryboardPanelSplitResult } from "./storyboard-split";

export type ControlledScriptDef = {
    id: string;
    name: string;
    description: string;
    handlerKey: string;
    timeoutMs: number;
    maxOutputBytes: number;
    enabled: boolean;
    /** 简化 JSON Schema：仅描述字段，一期不做完整校验引擎 */
    inputFields: { name: string; type: string; required?: boolean; description?: string }[];
};

const BUILTIN_SCRIPTS: ControlledScriptDef[] = [
    {
        id: "storyboard_grid_hint",
        name: "分镜拆镜提示词",
        description:
            "分镜两阶段：phase=plan 建议镜数+角色一致性草稿；phase=split 在用户确认 panels/characterBrief 后拆成每镜独立提示词。",
        handlerKey: "storyboard_grid_hint",
        timeoutMs: 90000,
        maxOutputBytes: 64 * 1024,
        enabled: true,
        inputFields: [
            { name: "phase", type: "string", required: false, description: "plan | split，默认未确认时走 plan" },
            { name: "panels", type: "number", required: false, description: "已确认的镜数（split 必填），2～8" },
            { name: "characterBrief", type: "string", required: false, description: "已确认的角色/画风一致性描述" },
            { name: "story", type: "string", required: false, description: "用户剧情原文" },
            { name: "prompt", type: "string", required: false, description: "同 story" },
            { name: "confirmed", type: "boolean", required: false, description: "true 表示用户已确认，可直接 split" },
            { name: "rows", type: "number", required: false },
            { name: "cols", type: "number", required: false },
        ],
    },
    {
        id: "prompt_budget_clip",
        name: "提示词长度裁剪",
        description: "按 maxChars 裁剪过长提示词，保留首尾关键句（不调用模型）",
        handlerKey: "prompt_budget_clip",
        timeoutMs: 3000,
        maxOutputBytes: 64 * 1024,
        enabled: true,
        inputFields: [
            { name: "text", type: "string", required: true },
            { name: "maxChars", type: "number", required: true, description: "默认 4000，上限 12000" },
        ],
    },
    {
        id: "aspect_preset_resolve",
        name: "比例预设归一",
        description: "将常见比例文案归一为 ARTN Dream/Video 可用的 aspectRatio 字段",
        handlerKey: "aspect_preset_resolve",
        timeoutMs: 2000,
        maxOutputBytes: 4 * 1024,
        enabled: true,
        inputFields: [{ name: "raw", type: "string", required: true, description: "如 竖屏、9:16、square" }],
    },
];

export function isControlledScriptsEnabled(): boolean {
    // 进程内 TS handler 默认开启；显式 false 才关闭
    return process.env.CONTROLLED_SCRIPTS_ENABLED !== "false";
}

function allowlistFromEnv(): Set<string> | null {
    const raw = process.env.CONTROLLED_SCRIPTS_JSON || "";
    if (!raw.trim()) return null;
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return null;
        return new Set(arr.map(String));
    } catch {
        return null;
    }
}

/** 当前进程可发现的受控脚本（未启用时返回空） */
export function listControlledScripts(): ControlledScriptDef[] {
    if (!isControlledScriptsEnabled()) return [];
    const allow = allowlistFromEnv();
    return BUILTIN_SCRIPTS.filter((s) => s.enabled && (!allow || allow.has(s.id)));
}

export function getControlledScript(id: string): ControlledScriptDef | undefined {
    return listControlledScripts().find((s) => s.id === id);
}

/**
 * 一期 in-process handlers（无 child_process）。
 * 未启用或未知 id 时抛错；由上层工具捕获。
 */
export async function runControlledScriptInProcess(
    scriptId: string,
    input: Record<string, unknown>
): Promise<{ ok: true; scriptId: string; result: unknown; durationMs: number }> {
    const started = Date.now();
    if (!isControlledScriptsEnabled()) {
        throw new Error("受控脚本已关闭（CONTROLLED_SCRIPTS_ENABLED=false）");
    }
    const def = getControlledScript(scriptId);
    if (!def) {
        throw new Error(`未知或未启用的受控脚本：${scriptId}`);
    }

    let result: unknown;
    switch (def.handlerKey) {
        case "storyboard_grid_hint": {
            result = await buildStoryboardPanelSplitResult(input);
            break;
        }
        case "prompt_budget_clip": {
            const text = String(input.text || "");
            let max = Number(input.maxChars);
            if (!Number.isFinite(max) || max <= 0) max = 4000;
            max = Math.min(12000, Math.max(200, max));
            if (text.length <= max) {
                result = { text, clipped: false, length: text.length };
            } else {
                const head = Math.floor(max * 0.7);
                const tail = max - head - 20;
                result = {
                    text: `${text.slice(0, head)}\n…\n${text.slice(-Math.max(0, tail))}`,
                    clipped: true,
                    length: text.length,
                    maxChars: max,
                };
            }
            break;
        }
        case "aspect_preset_resolve": {
            const raw = String(input.raw || "")
                .trim()
                .toLowerCase();
            const table: Record<string, string> = {
                "9:16": "9:16",
                "16:9": "16:9",
                "1:1": "1:1",
                "4:3": "4:3",
                "3:4": "3:4",
                "21:9": "21:9",
                竖屏: "9:16",
                横屏: "16:9",
                方形: "1:1",
                square: "1:1",
                portrait: "9:16",
                landscape: "16:9",
            };
            result = { aspectRatio: table[raw] || (raw.includes(":") ? raw : "1:1"), raw: input.raw };
            break;
        }
        default:
            throw new Error(`未实现的 handlerKey：${def.handlerKey}`);
    }

    const payload = JSON.stringify(result);
    if (Buffer.byteLength(payload, "utf8") > def.maxOutputBytes) {
        throw new Error("受控脚本输出超过大小上限");
    }

    return {
        ok: true,
        scriptId: def.id,
        result,
        durationMs: Date.now() - started,
    };
}

/** Agent 可见状态（类似 mcp_status） */
export function controlledScriptsStatusForAgent(): {
    enabled: boolean;
    scripts: { id: string; name: string; description: string }[];
    note: string;
} {
    const scripts = listControlledScripts();
    return {
        enabled: isControlledScriptsEnabled(),
        scripts: scripts.map((s) => ({ id: s.id, name: s.name, description: s.description })),
        note: isControlledScriptsEnabled()
            ? scripts.length
                ? "受控脚本已启用；可用 run_controlled_script 调用白名单 id。绝不执行 Skill 包内 scripts。"
                : "已启用但白名单为空（检查 CONTROLLED_SCRIPTS_JSON）"
            : "受控脚本已关闭（CONTROLLED_SCRIPTS_ENABLED=false）。Skill 包内 py/sh 仍不会执行。",
    };
}
