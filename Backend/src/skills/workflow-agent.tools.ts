/**
 * 工作流 Agent 工具白名单（Gemini / GPT-6 共用 schema）
 */
export type WorkflowToolName =
    | "list_skills"
    | "load_skill"
    | "get_workflow_snapshot"
    | "set_prompt_text"
    | "create_image_pipeline"
    | "create_video_pipeline"
    | "create_review_pipeline"
    | "propose_generate"
    | "ask_user";

export const WORKFLOW_TOOL_NAMES: WorkflowToolName[] = [
    "list_skills",
    "load_skill",
    "get_workflow_snapshot",
    "set_prompt_text",
    "create_image_pipeline",
    "create_video_pipeline",
    "create_review_pipeline",
    "propose_generate",
    "ask_user",
];

export function isWorkflowToolName(name: string): name is WorkflowToolName {
    return (WORKFLOW_TOOL_NAMES as string[]).includes(name);
}

/** OpenAI / Ace chat.completions tools 格式 */
export const WORKFLOW_TOOLS_OPENAI = [
    {
        type: "function",
        function: {
            name: "list_skills",
            description: "列出当前用户可用的 Skill（全员 global + 自己的 private）摘要",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "load_skill",
            description: "加载某个 Skill 的完整正文",
            parameters: {
                type: "object",
                properties: {
                    skillId: { type: "number", description: "Skill ID" },
                },
                required: ["skillId"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_workflow_snapshot",
            description: "获取当前画布精简快照（由客户端执行并回传结果）",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "set_prompt_text",
            description: "设置或新建 PromptNode 的提示词文本",
            parameters: {
                type: "object",
                properties: {
                    promptText: { type: "string" },
                    nodeId: { type: "string", description: "已有 PromptNode id，可选" },
                },
                required: ["promptText"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_image_pipeline",
            description: "创建 PromptNode + DreamNode 并连线（不触发生成）",
            parameters: {
                type: "object",
                properties: {
                    promptText: { type: "string" },
                    messageForUser: { type: "string" },
                },
                required: ["promptText"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_video_pipeline",
            description: "创建 PromptNode + VideoNode 并连线（不触发生成）",
            parameters: {
                type: "object",
                properties: {
                    promptText: { type: "string" },
                    messageForUser: { type: "string" },
                },
                required: ["promptText"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_review_pipeline",
            description: "创建 ReviewNode，可选连接效果图与需求图节点（不执行审核）",
            parameters: {
                type: "object",
                properties: {
                    effectNodeId: { type: "string", description: "效果图 ImageNode id" },
                    reqNodeIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "需求图 ImageNode id 列表",
                    },
                    messageForUser: { type: "string" },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "propose_generate",
            description: "标记某个 Dream/Video 节点待用户确认生成（不调用生成 API、不扣费）",
            parameters: {
                type: "object",
                properties: {
                    nodeId: { type: "string" },
                    messageForUser: { type: "string" },
                },
                required: ["nodeId"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ask_user",
            description: "向用户提问并暂停工具循环",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string" },
                },
                required: ["question"],
                additionalProperties: false,
            },
        },
    },
] as const;

export const WORKFLOW_AGENT_SYSTEM_PROMPT =
    "你是 ARTN 工作流画布的控制助手。你可以阅读已安装的 Skill，并通过工具编排画布节点。" +
    "规则：1) 只能调用提供的工具，禁止编造工具名；2) 不执行 Skill 内 scripts/MCP/终端；" +
    "3) 创建流水线后不要声称已经生成图片或视频，应提示用户在节点上确认执行；" +
    "4) 缺信息时用 ask_user；5) 用简体中文回复用户。";

export const AGENT_MAX_TOOL_ROUNDS = 6;
export const SKILL_BODY_INJECT_MAX_CHARS = 8000;
export const SKILL_PRIVATE_QUOTA_DEFAULT = 20;
export const SKILL_ZIP_MAX_BYTES = 5 * 1024 * 1024;
