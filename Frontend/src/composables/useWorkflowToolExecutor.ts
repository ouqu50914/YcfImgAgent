import { nextTick } from 'vue';
import { ElMessage } from 'element-plus';

export type WorkflowToolCall = {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  /** 兼容旧 intent JSON */
  intent?: string;
  promptText?: string;
  ui?: { messageForUser?: string };
};

export type ToolExecutorDeps = {
  getNodes: () => any[];
  getEdges: () => any[];
  addNodes: (n: any) => void;
  addEdges: (e: any) => void;
  updateNodeData?: (id: string, data: Record<string, unknown>) => void;
  calculateOptimalPosition: (type: string, preferred?: { x: number; y: number }) => { x: number; y: number };
  NODE_DIMENSIONS: Record<string, { width: number; height: number }>;
  HORIZONTAL_PADDING: number;
  saveState: () => void;
  persistWorkflow: () => void | Promise<void>;
  fitView: (opts?: any) => Promise<void> | void;
  setViewport: (v: any) => void;
  getViewport: () => any;
  listSkills?: () => Promise<unknown>;
  loadSkill?: (skillId: number) => Promise<unknown>;
};

function msgOf(cmd: WorkflowToolCall): string {
  return typeof cmd.ui?.messageForUser === 'string'
    ? cmd.ui.messageForUser
    : typeof cmd.arguments?.messageForUser === 'string'
      ? String(cmd.arguments.messageForUser)
      : '';
}

function promptOf(cmd: WorkflowToolCall): string {
  const a = cmd.arguments?.promptText ?? cmd.promptText;
  return typeof a === 'string' ? a.trim() : '';
}

/**
 * 画布工具执行器：兼容旧 gemini intent，并支持 Agent tool_call
 */
export function createWorkflowToolExecutor(deps: ToolExecutorDeps) {
  const execute = async (raw: WorkflowToolCall | Record<string, unknown>): Promise<string> => {
    const cmd = normalize(raw);
    const name = cmd.name || cmd.intent || '';
    try {
      switch (name) {
        case 'list_skills':
          if (deps.listSkills) return JSON.stringify(await deps.listSkills());
          return JSON.stringify({ skills: [] });
        case 'load_skill': {
          const skillId = Number(cmd.arguments?.skillId);
          if (!deps.loadSkill) return JSON.stringify({ error: 'loadSkill unavailable' });
          return JSON.stringify(await deps.loadSkill(skillId));
        }
        case 'get_workflow_snapshot':
          return JSON.stringify({
            nodes: deps.getNodes().map((n) => ({
              id: n.id,
              type: n.type,
              selected: n.selected,
              dataKeys: n.data ? Object.keys(n.data) : [],
              label: (n.data as any)?.label,
              text: typeof (n.data as any)?.text === 'string' ? String((n.data as any).text).slice(0, 200) : undefined,
              imageUrl: (n.data as any)?.imageUrl,
            })),
            edges: deps.getEdges().map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
          });
        case 'set_prompt_text':
          return await setPromptText(cmd);
        case 'create_image_pipeline':
        case 'create_image_pipeline' as string:
          return await createImagePipeline(cmd);
        case 'create_video_pipeline':
          return await createVideoPipeline(cmd);
        case 'create_review_pipeline':
          return await createReviewPipeline(cmd);
        case 'propose_generate':
          return await proposeGenerate(cmd);
        case 'ask_user':
          return JSON.stringify({ question: cmd.arguments?.question || '' });
        default:
          return JSON.stringify({ error: `unknown tool: ${name}` });
      }
    } catch (e: any) {
      console.error('[ToolExecutor]', e);
      return JSON.stringify({ error: e?.message || String(e) });
    }
  };

  const normalize = (raw: any): WorkflowToolCall => {
    if (!raw || typeof raw !== 'object') return { name: '' };
    if (raw.intent && !raw.name) {
      return {
        name: String(raw.intent),
        promptText: raw.promptText,
        ui: raw.ui,
        arguments: {
          promptText: raw.promptText,
          messageForUser: raw.ui?.messageForUser,
          ...(raw.arguments || {}),
        },
      };
    }
    return {
      id: raw.id,
      name: String(raw.name || raw.intent || ''),
      arguments: (raw.arguments || {}) as Record<string, unknown>,
      promptText: raw.promptText,
      ui: raw.ui,
    };
  };

  const afterLayout = async (prevZoom: number) => {
    deps.saveState();
    void deps.persistWorkflow();
    await nextTick();
    await deps.fitView({ padding: 0.08 });
    deps.setViewport({ ...(deps.getViewport() as any), zoom: prevZoom });
  };

  const setPromptText = async (cmd: WorkflowToolCall) => {
    const text = promptOf(cmd);
    if (!text) return JSON.stringify({ error: 'promptText required' });
    const nodeId = typeof cmd.arguments?.nodeId === 'string' ? cmd.arguments.nodeId : '';
    const nodes = deps.getNodes();
    if (nodeId) {
      const n = nodes.find((x) => x.id === nodeId && x.type === 'prompt');
      if (!n) return JSON.stringify({ error: 'prompt node not found' });
      if (deps.updateNodeData) deps.updateNodeData(nodeId, { ...(n.data || {}), text });
      else n.data = { ...(n.data || {}), text };
      deps.saveState();
      void deps.persistWorkflow();
      return JSON.stringify({ ok: true, nodeId });
    }
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const id = `prompt_node_agent_${Date.now()}`;
    const pos = deps.calculateOptimalPosition('prompt');
    deps.addNodes({ id, type: 'prompt', position: pos, data: { text } });
    await afterLayout(prevZoom);
    return JSON.stringify({ ok: true, nodeId: id });
  };

  const createImagePipeline = async (cmd: WorkflowToolCall) => {
    const promptText = promptOf(cmd);
    if (!promptText) return JSON.stringify({ error: 'promptText required' });
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const promptId = `prompt_node_gemini_${Date.now()}`;
    const dreamId = `dream_node_gemini_${Date.now()}`;
    const promptPos = deps.calculateOptimalPosition('prompt');
    const dreamPreferred = {
      x: promptPos.x + (deps.NODE_DIMENSIONS.prompt?.width || 360) + deps.HORIZONTAL_PADDING,
      y: promptPos.y,
    };
    const dreamPos = deps.calculateOptimalPosition('dream', dreamPreferred);
    deps.addNodes({ id: promptId, type: 'prompt', position: promptPos, data: { text: promptText } });
    deps.addNodes({ id: dreamId, type: 'dream', position: dreamPos, data: {} });
    deps.addEdges({
      id: `edge_${promptId}_to_${dreamId}_${Date.now()}`,
      source: promptId,
      target: dreamId,
      sourceHandle: 'prompt-source',
      targetHandle: 'target',
      type: 'default',
      animated: true,
    });
    await afterLayout(prevZoom);
    ElMessage.success(msgOf(cmd) || '已自动创建并连接生图节点，请到生图节点手动点击执行生成。');
    return JSON.stringify({ ok: true, promptId, dreamId });
  };

  const createVideoPipeline = async (cmd: WorkflowToolCall) => {
    const promptText = promptOf(cmd);
    if (!promptText) return JSON.stringify({ error: 'promptText required' });
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const promptId = `prompt_node_gemini_${Date.now()}`;
    const videoId = `video_node_gemini_${Date.now()}`;
    const promptPos = deps.calculateOptimalPosition('prompt');
    const videoPreferred = {
      x: promptPos.x + (deps.NODE_DIMENSIONS.prompt?.width || 360) + deps.HORIZONTAL_PADDING,
      y: promptPos.y,
    };
    const videoPos = deps.calculateOptimalPosition('video', videoPreferred);
    deps.addNodes({ id: promptId, type: 'prompt', position: promptPos, data: { text: promptText } });
    deps.addNodes({ id: videoId, type: 'video', position: videoPos, data: {} });
    deps.addEdges({
      id: `edge_${promptId}_to_${videoId}_${Date.now()}`,
      source: promptId,
      target: videoId,
      sourceHandle: 'prompt-source',
      targetHandle: 'target',
      type: 'default',
      animated: true,
    });

    const parseImageTs = (nodeId: string): number => {
      const m = nodeId.match(/^image_node_(\d+)_/);
      return m ? Number(m[1]) : 0;
    };
    const allNodes = deps.getNodes();
    const allEdges = deps.getEdges();
    const imgs = allNodes.filter((n) => n.type === 'image' && typeof (n.data as any)?.imageUrl === 'string');
    const maxTs = Math.max(...imgs.map((n) => parseImageTs(n.id)), 0);
    const imageNodesToConnect = maxTs ? imgs.filter((n) => parseImageTs(n.id) === maxTs) : [];
    if (imageNodesToConnect.length > 0) {
      const alreadyConnected = new Set(
        allEdges.filter((e) => e.target === videoId).map((e) => `${e.source}::${e.target}`)
      );
      for (const img of imageNodesToConnect) {
        const key = `${img.id}::${videoId}`;
        if (alreadyConnected.has(key)) continue;
        deps.addEdges({
          id: `edge_${img.id}_to_${videoId}_${Date.now()}`,
          source: img.id,
          target: videoId,
          sourceHandle: 'image-source',
          targetHandle: 'target',
          type: 'default',
          animated: true,
        });
      }
    }

    await afterLayout(prevZoom);
    ElMessage.success(msgOf(cmd) || '已自动创建并连接视频节点，请到视频节点手动点击执行生成。');
    return JSON.stringify({ ok: true, promptId, videoId });
  };

  const createReviewPipeline = async (cmd: WorkflowToolCall) => {
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const reviewId = `review_node_agent_${Date.now()}`;
    const pos = deps.calculateOptimalPosition('review');
    deps.addNodes({ id: reviewId, type: 'review', position: pos, data: {} });
    const effectNodeId = typeof cmd.arguments?.effectNodeId === 'string' ? cmd.arguments.effectNodeId : '';
    if (effectNodeId) {
      deps.addEdges({
        id: `edge_${effectNodeId}_to_${reviewId}_${Date.now()}`,
        source: effectNodeId,
        target: reviewId,
        sourceHandle: 'image-source',
        targetHandle: 'target',
        type: 'default',
        animated: true,
      });
    }
    const reqNodeIds = Array.isArray(cmd.arguments?.reqNodeIds)
      ? (cmd.arguments!.reqNodeIds as unknown[]).map(String)
      : [];
    for (const rid of reqNodeIds) {
      deps.addEdges({
        id: `edge_${rid}_to_${reviewId}_req_${Date.now()}`,
        source: rid,
        target: reviewId,
        sourceHandle: 'image-source',
        targetHandle: 'req',
        type: 'default',
        animated: true,
      });
    }
    await afterLayout(prevZoom);
    ElMessage.success(msgOf(cmd) || '已创建审核节点，请点击「执行审核」。');
    return JSON.stringify({ ok: true, reviewId });
  };

  const proposeGenerate = async (cmd: WorkflowToolCall) => {
    const nodeId = typeof cmd.arguments?.nodeId === 'string' ? cmd.arguments.nodeId : '';
    if (!nodeId) return JSON.stringify({ error: 'nodeId required' });
    const n = deps.getNodes().find((x) => x.id === nodeId);
    if (!n || (n.type !== 'dream' && n.type !== 'video')) {
      return JSON.stringify({ error: 'dream/video node not found' });
    }
    const data = { ...(n.data || {}), proposeGenerate: true, proposeMessage: msgOf(cmd) };
    if (deps.updateNodeData) deps.updateNodeData(nodeId, data);
    else n.data = data;
    deps.saveState();
    ElMessage.info(msgOf(cmd) || `请确认后在节点 ${nodeId} 上点击执行生成`);
    return JSON.stringify({ ok: true, nodeId, pendingConfirm: true });
  };

  /** 兼容旧入口：只处理 create_* intent */
  const executeGeminiCommand = async (cmd: any) => {
    await execute(cmd);
  };

  return { execute, executeGeminiCommand };
}
