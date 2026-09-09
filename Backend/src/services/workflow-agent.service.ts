import axios from "axios";
import {
    AGENT_MAX_TOOL_ROUNDS,
    WORKFLOW_AGENT_SYSTEM_PROMPT,
    WORKFLOW_TOOLS_OPENAI,
    isWorkflowToolName,
} from "../skills/workflow-agent.tools";
import { SkillService } from "./skill.service";

export type AgentChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
    name?: string;
    tool_calls?: AgentToolCall[];
};

export type AgentToolCall = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
};

export type ControlModelResult = {
    text?: string;
    toolCalls?: AgentToolCall[];
};

export interface ControlModelProvider {
    chatWithTools(messages: AgentChatMessage[], tools: typeof WORKFLOW_TOOLS_OPENAI): Promise<ControlModelResult>;
}

function getProviderName(): "gemini" | "gpt6" {
    const p = (process.env.WORKFLOW_AGENT_PROVIDER || "gemini").trim().toLowerCase();
    return p === "gpt6" ? "gpt6" : "gemini";
}

export class GeminiControlProvider implements ControlModelProvider {
    async chatWithTools(messages: AgentChatMessage[], tools: typeof WORKFLOW_TOOLS_OPENAI): Promise<ControlModelResult> {
        const API_KEY = process.env.GEMINI_CHAT_API_KEY;
        const API_URL = process.env.GEMINI_CHAT_API_URL?.trim();
        const model = (process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash").trim();
        if (!API_KEY) throw new Error("未配置 GEMINI_CHAT_API_KEY");
        if (!API_URL) throw new Error("未配置 GEMINI_CHAT_API_URL");

        const payload = {
            model,
            messages: messages.map((m) => {
                const base: Record<string, unknown> = { role: m.role, content: m.content };
                if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
                if (m.name) base.name = m.name;
                if (m.tool_calls?.length) {
                    base.tool_calls = m.tool_calls.map((t) => ({
                        id: t.id,
                        type: "function",
                        function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) },
                    }));
                }
                return base;
            }),
            tools,
            tool_choice: "auto",
            temperature: 0.2,
        };

        const resp = await axios.post(API_URL, payload, {
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: Number(process.env.WORKFLOW_AGENT_TIMEOUT_MS || "120000"),
        });

        const msg = resp.data?.choices?.[0]?.message;
        return normalizeAssistantMessage(msg);
    }
}

export class Gpt6ControlProvider implements ControlModelProvider {
    async chatWithTools(messages: AgentChatMessage[], tools: typeof WORKFLOW_TOOLS_OPENAI): Promise<ControlModelResult> {
        const API_KEY = process.env.WORKFLOW_AGENT_GPT6_API_KEY || process.env.API_KEY || process.env.GEMINI_CHAT_API_KEY;
        const API_BASE = (process.env.WORKFLOW_AGENT_GPT6_API_BASE || process.env.API_BASE || "https://api.acedata.cloud/v1").replace(
            /\/$/,
            ""
        );
        const model = (process.env.WORKFLOW_AGENT_GPT6_MODEL || "gpt-6-astra").trim();
        if (!API_KEY) throw new Error("未配置 WORKFLOW_AGENT_GPT6_API_KEY（或 API_KEY）");

        const payload = {
            model,
            messages: messages.map((m) => {
                const base: Record<string, unknown> = { role: m.role, content: m.content };
                if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
                if (m.name) base.name = m.name;
                if (m.tool_calls?.length) {
                    base.tool_calls = m.tool_calls.map((t) => ({
                        id: t.id,
                        type: "function",
                        function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) },
                    }));
                }
                return base;
            }),
            tools,
            tool_choice: "auto",
            temperature: 0.2,
        };

        const resp = await axios.post(`${API_BASE}/chat/completions`, payload, {
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: Number(process.env.WORKFLOW_AGENT_TIMEOUT_MS || "120000"),
        });

        const msg = resp.data?.choices?.[0]?.message;
        return normalizeAssistantMessage(msg);
    }
}

function normalizeAssistantMessage(msg: any): ControlModelResult {
    if (!msg) return { text: "" };
    const text = typeof msg.content === "string" ? msg.content : "";
    const rawCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const toolCalls: AgentToolCall[] = [];
    for (const c of rawCalls) {
        const name = c?.function?.name || c?.name;
        if (!name || !isWorkflowToolName(String(name))) continue;
        let args: Record<string, unknown> = {};
        const argStr = c?.function?.arguments ?? c?.arguments;
        if (typeof argStr === "string" && argStr.trim()) {
            try {
                args = JSON.parse(argStr);
            } catch {
                args = {};
            }
        } else if (argStr && typeof argStr === "object") {
            args = argStr as Record<string, unknown>;
        }
        toolCalls.push({
            id: String(c.id || `call_${toolCalls.length + 1}`),
            name: String(name),
            arguments: args,
        });
    }
    return {
        text,
        ...(toolCalls.length ? { toolCalls } : {}),
    };
}

export function createControlModelProvider(): ControlModelProvider {
    return getProviderName() === "gpt6" ? new Gpt6ControlProvider() : new GeminiControlProvider();
}

export type AgentSseEvent =
    | { type: "text_delta"; text: string }
    | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
    | { type: "ask_user"; question: string }
    | { type: "done"; text?: string }
    | { type: "error"; message: string };

export function isAgentChatEnabled(): boolean {
    return process.env.AGENT_CHAT_ENABLED !== "false";
}

/**
 * 单步：根据当前 messages 调控制模型；若返回 tool_call 则通过 onEvent 抛出，由客户端执行后 continue。
 * 服务端可执行的工具：list_skills / load_skill（其余一律下发客户端）。
 */
export class WorkflowAgentService {
    private skillService = new SkillService();
    private provider = createControlModelProvider();

    async buildInitialMessages(params: {
        userId: number;
        message: string;
        history?: { role: "user" | "assistant"; content: string }[];
        workflowContext?: unknown;
        skillIds?: number[];
    }): Promise<AgentChatMessage[]> {
        const catalog = await this.skillService.summarizeForAgent(params.userId);
        const catalogText = catalog.length
            ? catalog.map((s) => `- id=${s.id} name=${s.name}: ${s.description}`).join("\n")
            : "（暂无可用 Skill）";

        let selected = "";
        if (params.skillIds?.length) {
            const parts: string[] = [];
            for (const id of params.skillIds.slice(0, 5)) {
                try {
                    const row = await this.skillService.getForUser(params.userId, id);
                    parts.push(
                        `### Skill ${row.name} (id=${row.id})\n${this.skillService.truncateBody(row.body_md)}`
                    );
                } catch {
                    /* skip inaccessible */
                }
            }
            selected = parts.join("\n\n");
        }

        const ctx =
            params.workflowContext != null
                ? `当前工作流上下文：${JSON.stringify(params.workflowContext).slice(0, 12000)}`
                : "";

        const system =
            WORKFLOW_AGENT_SYSTEM_PROMPT +
            `\n\n## 可用 Skill 目录\n${catalogText}` +
            (selected ? `\n\n## 用户选中的 Skill 正文\n${selected}` : "") +
            (ctx ? `\n\n${ctx}` : "");

        const messages: AgentChatMessage[] = [{ role: "system", content: system }];
        if (Array.isArray(params.history)) {
            for (const h of params.history.slice(-8)) {
                if (!h?.content) continue;
                messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content });
            }
        }
        messages.push({ role: "user", content: params.message });
        return messages;
    }

    async runModelTurn(messages: AgentChatMessage[]): Promise<ControlModelResult> {
        return this.provider.chatWithTools(messages, WORKFLOW_TOOLS_OPENAI as any);
    }

    /** 尝试服务端执行；返回 null 表示需客户端执行 */
    async tryServerTool(
        userId: number,
        name: string,
        args: Record<string, unknown>
    ): Promise<string | null> {
        if (name === "list_skills") {
            const list = await this.skillService.summarizeForAgent(userId);
            return JSON.stringify({ skills: list });
        }
        if (name === "load_skill") {
            const skillId = Number(args.skillId);
            const row = await this.skillService.getForUser(userId, skillId);
            return JSON.stringify({
                id: row.id,
                name: row.name,
                description: row.description,
                body_md: this.skillService.truncateBody(row.body_md),
            });
        }
        return null;
    }

    get maxRounds(): number {
        return AGENT_MAX_TOOL_ROUNDS;
    }
}
