/**
 * 受控 MCP 接入脚手架（默认关闭）。
 * 环境变量：
 * - MCP_ENABLED=true
 * - MCP_SERVERS_JSON=[{"id":"docs","name":"文档库","transport":"sse","url":"https://..."}]
 *
 * 市场 Skill 不得自行声明并连接任意 MCP；仅管理员配置的服务器可被 Agent 发现。
 */
export type McpServerConfig = {
    id: string;
    name: string;
    transport: "sse" | "stdio";
    url?: string;
    command?: string;
    args?: string[];
    enabled?: boolean;
};

export function isMcpEnabled(): boolean {
    return process.env.MCP_ENABLED === "true";
}

export function listConfiguredMcpServers(): McpServerConfig[] {
    if (!isMcpEnabled()) return [];
    const raw = process.env.MCP_SERVERS_JSON || "[]";
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((s) => s && s.id && s.name && s.enabled !== false)
            .map((s) => {
                const cfg: McpServerConfig = {
                    id: String(s.id),
                    name: String(s.name),
                    transport: s.transport === "stdio" ? "stdio" : "sse",
                    enabled: true,
                };
                if (s.url) cfg.url = String(s.url);
                if (s.command) cfg.command = String(s.command);
                if (Array.isArray(s.args)) cfg.args = s.args.map(String);
                return cfg;
            });
    } catch {
        return [];
    }
}

/** Agent 可见摘要（尚未实现真实 tool 桥接时仅返回配置清单） */
export function mcpStatusForAgent(): {
    enabled: boolean;
    servers: { id: string; name: string; transport: string }[];
    note: string;
} {
    const servers = listConfiguredMcpServers();
    return {
        enabled: isMcpEnabled(),
        servers: servers.map((s) => ({ id: s.id, name: s.name, transport: s.transport })),
        note: isMcpEnabled()
            ? servers.length
                ? "MCP 已启用；工具桥接将在后续版本接入白名单调用"
                : "MCP 已启用但未配置 MCP_SERVERS_JSON"
            : "MCP 未启用（MCP_ENABLED!=true）。Skill 中要求 MCP 的步骤记入不可适配项。",
    };
}
