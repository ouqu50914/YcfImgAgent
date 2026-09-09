/**
 * 工作流 Agent 工具白名单（Gemini / GPT-6 共用 schema）
 */
export type WorkflowToolName =
    | "list_skills"
    | "load_skill"
    | "list_skill_assets"
    | "load_skill_asset"
    | "get_workflow_snapshot"
    | "set_prompt_text"
    | "create_image_nodes"
    | "connect_nodes"
    | "configure_node"
    | "create_image_pipeline"
    | "create_video_pipeline"
    | "create_review_pipeline"
    | "propose_generate"
    | "ask_user"
    | "mcp_status";

export const WORKFLOW_TOOL_NAMES: WorkflowToolName[] = [
    "list_skills",
    "load_skill",
    "list_skill_assets",
    "load_skill_asset",
    "get_workflow_snapshot",
    "set_prompt_text",
    "create_image_nodes",
    "connect_nodes",
    "configure_node",
    "create_image_pipeline",
    "create_video_pipeline",
    "create_review_pipeline",
    "propose_generate",
    "ask_user",
    "mcp_status",
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
            description: "加载某个 Skill 的完整正文，并返回包内附件路径清单",
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
            name: "list_skill_assets",
            description: "列出 Skill 包内 references/assets 文本附件路径（按需再 load_skill_asset）",
            parameters: {
                type: "object",
                properties: {
                    skillId: { type: "number" },
                },
                required: ["skillId"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "load_skill_asset",
            description: "读取 Skill 包内单个文本附件（如 references/prompt-template.md）",
            parameters: {
                type: "object",
                properties: {
                    skillId: { type: "number" },
                    path: {
                        type: "string",
                        description: "相对路径，如 references/style-dictionary.md",
                    },
                },
                required: ["skillId", "path"],
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
            description:
                "设置或新建 PromptNode 的提示词文本。节点执行只读这里的正文：Skill 的 2x2/分镜/版式约束必须写进 promptText，不能只写在对话里。",
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
            name: "create_image_nodes",
            description: "在画布上创建一个或多个 ImageNode（参考图），不触发生成",
            parameters: {
                type: "object",
                properties: {
                    imageUrls: {
                        type: "array",
                        items: { type: "string" },
                        description: "图片 URL 列表（用户上传或已有绝对/相对 URL）",
                    },
                    messageForUser: { type: "string" },
                },
                required: ["imageUrls"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "connect_nodes",
            description: "连接两个已有节点（如 Image→Dream、Prompt→Dream）",
            parameters: {
                type: "object",
                properties: {
                    sourceNodeId: { type: "string" },
                    targetNodeId: { type: "string" },
                    sourceHandle: { type: "string" },
                    targetHandle: { type: "string" },
                },
                required: ["sourceNodeId", "targetNodeId"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "configure_node",
            description:
                "配置 Dream/Video/Prompt 节点参数（模型、数量、分辨率、比例、提示词等），不触发生成。优先复用节点已有 generationPrefs。Dream/Video 上的 skillId 在用户点执行时不会生效；版式/分镜必须写入 Prompt 的 promptText。",
            parameters: {
                type: "object",
                properties: {
                    nodeId: { type: "string" },
                    model: { type: "string", description: "如 dream / gpt-image-2:anyfast" },
                    aspectRatio: { type: "string", description: "如 16:9 / 9:16 / 1:1" },
                    resolution: { type: "string", description: "Dream 常用 1K/2K/4K；Video 常用 720p/1080p" },
                    quality: { type: "string", description: "与节点画质/分辨率对应，如 2K / medium" },
                    numImages: { type: "number", description: "生成数量" },
                    provider: { type: "string", description: "Video：kling/seedance/pixverse" },
                    durationSeconds: { type: "number", description: "Video 时长秒" },
                    skillId: {
                        type: "number",
                        description: "已废弃：节点执行不会读取 skillId，请改用 set_prompt_text 写入版式约束",
                    },
                    promptText: {
                        type: "string",
                        description: "若目标为 PromptNode 则写入文本（须含分镜/版式指令，如 2x2 宫格）",
                    },
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
            name: "create_image_pipeline",
            description: "创建 PromptNode + DreamNode 并连线；可挂参考图与生成参数（不触发生成）",
            parameters: {
                type: "object",
                properties: {
                    promptText: { type: "string" },
                    messageForUser: { type: "string" },
                    model: { type: "string" },
                    aspectRatio: { type: "string" },
                    resolution: { type: "string" },
                    quality: { type: "string" },
                    numImages: { type: "number" },
                    skillId: { type: "number" },
                    referenceNodeIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "要连到 Dream 的 ImageNode id",
                    },
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
                    skillId: { type: "number" },
                    provider: { type: "string" },
                    aspectRatio: { type: "string" },
                    resolution: { type: "string" },
                    durationSeconds: { type: "number" },
                    referenceNodeIds: {
                        type: "array",
                        items: { type: "string" },
                    },
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
            description: "向用户提问并暂停本轮工具循环；用户下一条消息继续执行 Skill 流程",
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
    {
        type: "function",
        function: {
            name: "mcp_status",
            description: "查询平台受控 MCP 是否启用及已配置服务器（不执行外部工具）",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
] as const;

export const WORKFLOW_AGENT_SYSTEM_PROMPT =
    "你是 ARTN 工作流画布的控制 Agent（Gemini/GPT-6）。用户选定 Skill 后，你必须按 Skill 固定流程编排现有节点。" +
    "规则：1) 只能调用白名单工具，禁止编造工具名；2) 不执行 Skill 内 scripts/MCP/终端；" +
    "3) 先 get_workflow_snapshot 了解画布；需要规范/模板时用 list_skill_assets + load_skill_asset 按需读取，勿一次塞入全部附件；" +
    "4) 缺角色参考图、风格、剧情、海报文案等 Skill 领域信息时必须 ask_user；但生图/视频节点上已有的模型、数量、分辨率、图片比例、时长等生成参数必须直接复用，禁止再向用户确认，除非用户或 Skill 明确要求改；" +
    "5) 若消息里给出了 sourceNodeId / generationPrefs，优先 configure_node 更新该节点并在其上 propose_generate，避免无必要新建重复 Dream/Video；新建流水线时也要把这些参数写入 create_*_pipeline；" +
    "6) Skill 正文若引用不存在的 references 路径，跳过该文件并继续，勿卡死；市场 Skill 中的 AskUserQuestion 等同 ask_user，禁止执行 scripts；" +
    "7) 用 create_image_nodes / connect_nodes / create_image_pipeline / configure_node 搭好后，用 propose_generate 请用户在节点上确认执行——禁止声称已生成；" +
    "8) 生图/视频/质检仍走现有节点，你只负责编排；节点「执行/再次执行」只读取连线上的提示词与参考图，不会再读取 Skill；" +
    "9) 因此 Skill 中的版式/分镜约束（如 2x2 宫格、四格漫画、九宫格、分镜比例）必须用 set_prompt_text 写进实际连接的 Prompt 节点正文，不能只在对话里说明，也不能只靠给 Dream/Video 绑定 skillId；" +
    "10) 改写提示词时保留用户剧情内容，并明确追加版式指令（例：「请生成一张 2x2 宫格分镜图，四格从左到右、从上到下」）；" +
    "11) 用简体中文与用户对话。";

export const AGENT_MAX_TOOL_ROUNDS = 12;
export const SKILL_BODY_INJECT_MAX_CHARS = 12000;
export const SKILL_ASSET_INJECT_MAX_CHARS = 6000;
export const SKILL_PRIVATE_QUOTA_DEFAULT = 20;
export const SKILL_ZIP_MAX_BYTES = 5 * 1024 * 1024;
