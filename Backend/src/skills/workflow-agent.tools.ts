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
    | "mcp_status"
    | "controlled_scripts_status"
    | "run_controlled_script";

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
    "controlled_scripts_status",
    "run_controlled_script",
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
                "设置或新建 PromptNode 的提示词文本。仅当 Skill 步骤或用户明确要求改文案时使用；不要擅自扩写。",
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
                "配置 Dream/Video/Prompt 节点参数（模型、数量、分辨率、比例等），不触发生成。优先复用节点已有 generationPrefs。不要借此擅自改写长提示词。",
            parameters: {
                type: "object",
                properties: {
                    nodeId: { type: "string" },
                    model: { type: "string", description: "如 gpt-2.5 / gpt-2.5-pro / gpt-2.0 / nano-2 / nano-pro；测试渠道如 gpt-image-2.5-flare:ace" },
                    aspectRatio: { type: "string", description: "如 16:9 / 9:16 / 1:1" },
                    resolution: { type: "string", description: "Dream 常用 1K/2K/4K；Video 常用 720p/1080p" },
                    quality: { type: "string", description: "与节点画质/分辨率对应，如 2K / medium" },
                    numImages: { type: "number", description: "生成数量" },
                    provider: { type: "string", description: "Video：kling/seedance/pixverse" },
                    durationSeconds: { type: "number", description: "Video 时长秒" },
                    skillId: {
                        type: "number",
                        description: "已废弃：节点执行不会读取 skillId",
                    },
                    promptText: {
                        type: "string",
                        description: "若目标为 PromptNode 则写入文本（仅当 Skill/用户要求改提示词时使用；不要擅自扩写分镜套话）",
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
            description:
                "默认创建 Prompt+Dream 并连线。仅批量分镜等场景传 presentation=images_only：不建编排节点，返回 jobId，确认后只落 Image。",
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
                    panelIndex: { type: "number", description: "分镜序号（images_only 时建议传）" },
                    skillId: { type: "number" },
                    presentation: {
                        type: "string",
                        description: "默认 full；批量分镜传 images_only 才只落图片集合",
                    },
                    sourceDreamNodeId: {
                        type: "string",
                        description: "images_only 时：把分镜集合连到该 Dream 之后以便追源",
                    },
                    dreamNodeId: { type: "string", description: "同 sourceDreamNodeId" },
                    referenceNodeIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "参考图 ImageNode id",
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
            description:
                "挂起待用户确认的生成。普通链路传 Dream/Video 的 nodeId；批量 images_only 传 create_image_pipeline 返回的 jobId。默认不扣费；用户点「确认并生成」后执行。禁止用于疑问句；不要用本工具改写 Prompt。",
            parameters: {
                type: "object",
                properties: {
                    jobId: { type: "string", description: "headless 出图任务 id（推荐）" },
                    nodeId: { type: "string", description: "Dream/Video 节点 id（兼容）" },
                    messageForUser: { type: "string" },
                },
                required: [],
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
    {
        type: "function",
        function: {
            name: "controlled_scripts_status",
            description:
                "查询平台受控脚本白名单状态。绝不执行 Skill 包内 scripts；默认启用平台预置脚本（可用 CONTROLLED_SCRIPTS_ENABLED=false 关闭）。",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    {
        type: "function",
        function: {
            name: "run_controlled_script",
            description:
                "调用平台白名单受控脚本。分镜 Skill：scriptId=storyboard_grid_hint；先 phase=plan，ask_user 确认后再 phase=split；再对每镜 create_image_pipeline(presentation=images_only,numImages=1)+propose_generate(jobId)。禁止执行用户上传的 py/sh。",
            parameters: {
                type: "object",
                properties: {
                    scriptId: { type: "string", description: "白名单 id，如 storyboard_grid_hint" },
                    input: { type: "object", description: "脚本入参对象" },
                },
                required: ["scriptId"],
                additionalProperties: false,
            },
        },
    },
] as const;

export const WORKFLOW_AGENT_SYSTEM_PROMPT =
    "你是 ARTN 工作流画布的调度 Agent（GPT-6）。职责仅限：按用户选定的 Skill 与用户指令编排画布（查快照、建连节点、改节点参数、挂起生成、向用户提问）。" +
    "你不是提示词作者：不要主动改写、扩写或往 Prompt 里塞分镜/版式套话；提示词内容以用户原文、Skill 正文、以及用户在节点上的「智能优化」结果为准。" +
    "规则：1) 只能调用白名单工具，禁止编造工具名；2) 不执行 Skill 内 scripts/任意 MCP/终端；" +
    "3) 先 get_workflow_snapshot；需要 Skill 附件时用 list_skill_assets + load_skill_asset，勿一次塞入全部；" +
    "4) 缺角色参考图、风格、剧情等 Skill 要求的领域信息时 ask_user；节点上已有的模型/数量/分辨率/比例/时长等 generationPrefs 直接复用，禁止再问，除非用户或 Skill 明确要求改；" +
    "5) 有 sourceNodeId / generationPrefs 时优先 configure_node 更新已有 Dream/Video 再 propose_generate，避免重复新建；" +
    "6) Skill 引用缺失的 references 则跳过并继续；AskUserQuestion 等同 ask_user；" +
    "7) 编排完成后 propose_generate 仅挂起；须用户在聊天点「确认并生成」才扣费。授权回合内（消息会注明）可再 propose 并自动执行，但须节省额度。禁止未完成就声称已出图；禁止自检失败连环 propose；疑问句只回答或 ask_user，禁止 propose；" +
    "8) 节点「执行/再次执行」只读连线 Prompt 与参考图、不读 Skill——因此若 Skill 要求改提示词，只能按 Skill 步骤调用 set_prompt_text，且以 Skill/用户内容为准，禁止自行发明分镜模板；" +
    "9) 仅当所选 Skill 或用户明确要求时才 run_controlled_script；若是分镜成品图 Skill：先 phase=plan 得到角色锁定档案 characterBrief，ask_user 核对帽子/服装等细节后再 phase=split；每镜 create_image_pipeline(presentation=images_only,numImages=1,必须 referenceNodeIds) + propose_generate(jobId)；禁止漏参考图、禁止改写锁定外观；其它场景默认建 Prompt+Dream；" +
    "10) 用简体中文与用户对话。";

export const AGENT_MAX_TOOL_ROUNDS = 12;
export const SKILL_BODY_INJECT_MAX_CHARS = 12000;
export const SKILL_ASSET_INJECT_MAX_CHARS = 6000;
export const SKILL_PRIVATE_QUOTA_DEFAULT = 20;
export const SKILL_ZIP_MAX_BYTES = 5 * 1024 * 1024;
