import { nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { useAgentAuthorizedRun } from '@/composables/useAgentAuthorizedRun';
import {
  assignStripAnchors,
  getHeadlessImageJob,
  listHeadlessImageJobs,
  registerHeadlessImageJob,
  runHeadlessImageJob,
} from '@/composables/headlessImageJobs';

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
  persistWorkflow: () => void | Promise<unknown>;
  fitView: (opts?: any) => void | Promise<unknown>;
  setViewport: (v: any) => void;
  getViewport: () => any;
  listSkills?: () => Promise<unknown>;
  loadSkill?: (skillId: number) => Promise<unknown>;
  /** false=画布隐藏 Prompt/Dream 等编排节点，只露出图（Agent 管线默认） */
  getShowEngineNodes?: () => boolean;
  getTemplateId?: () => number | null | undefined;
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

function defaultHandles(sourceType: string, targetType: string): { sourceHandle: string; targetHandle: string } {
  if (sourceType === 'prompt') return { sourceHandle: 'prompt-source', targetHandle: 'target' };
  if (sourceType === 'image') return { sourceHandle: 'image-source', targetHandle: 'target' };
  if (sourceType === 'dream' || sourceType === 'video') return { sourceHandle: 'source', targetHandle: 'target' };
  return { sourceHandle: 'source', targetHandle: 'target' };
}

/**
 * 画布工具执行器：兼容旧 gemini intent，并支持 Agent tool_call
 */
export function createWorkflowToolExecutor(deps: ToolExecutorDeps) {
  const authRun = useAgentAuthorizedRun();

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
        case 'list_skill_assets':
        case 'load_skill_asset':
          return JSON.stringify({
            error: 'server-only tool; should be executed by agent backend',
            name,
          });
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
              model: (n.data as any)?.model,
              selectedModel: (n.data as any)?.selectedModel,
              aspectRatio: (n.data as any)?.aspectRatio,
              quality: (n.data as any)?.quality,
              resolution: (n.data as any)?.resolution,
              numImages: (n.data as any)?.numImages,
              provider: (n.data as any)?.provider,
              durationSeconds: (n.data as any)?.durationSeconds ?? (n.data as any)?.durationManual,
              skillId: (n.data as any)?.skillId,
              proposeGenerate: !!(n.data as any)?.proposeGenerate,
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
        case 'create_image_nodes':
          return await createImageNodes(cmd);
        case 'connect_nodes':
          return await connectNodes(cmd);
        case 'configure_node':
          return await configureNode(cmd);
        case 'create_image_pipeline':
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

  const afterLayout = async (prevZoom: number, opts?: { skipFitView?: boolean }) => {
    deps.saveState();
    void deps.persistWorkflow();
    await nextTick();
    if (!opts?.skipFitView) {
      await deps.fitView({ padding: 0.08 });
      deps.setViewport({ ...(deps.getViewport() as any), zoom: prevZoom });
    }
  };

  const patchNodeData = (nodeId: string, patch: Record<string, unknown>) => {
    const n = deps.getNodes().find((x) => x.id === nodeId);
    if (!n) return false;
    const data = { ...(n.data || {}), ...patch };
    if (deps.updateNodeData) deps.updateNodeData(nodeId, data);
    else n.data = data;
    return true;
  };

  const setPromptText = async (cmd: WorkflowToolCall) => {
    const text = promptOf(cmd);
    if (!text) return JSON.stringify({ error: 'promptText required' });
    const nodeId = typeof cmd.arguments?.nodeId === 'string' ? cmd.arguments.nodeId : '';
    const nodes = deps.getNodes();
    if (nodeId) {
      const n = nodes.find((x) => x.id === nodeId && x.type === 'prompt');
      if (!n) return JSON.stringify({ error: 'prompt node not found' });
      patchNodeData(nodeId, { text });
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

  const createImageNodes = async (cmd: WorkflowToolCall) => {
    const urls = Array.isArray(cmd.arguments?.imageUrls)
      ? (cmd.arguments!.imageUrls as unknown[]).map(String).filter(Boolean)
      : [];
    if (!urls.length) return JSON.stringify({ error: 'imageUrls required' });
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const created: string[] = [];
    const base = deps.calculateOptimalPosition('image');
    urls.slice(0, 8).forEach((url, i) => {
      const id = `image_node_agent_${Date.now()}_${i}`;
      deps.addNodes({
        id,
        type: 'image',
        position: { x: base.x, y: base.y + i * ((deps.NODE_DIMENSIONS.image?.height || 220) + 24) },
        data: { imageUrl: url, originalImageUrl: url },
      });
      created.push(id);
    });
    await afterLayout(prevZoom);
    if (msgOf(cmd)) ElMessage.success(msgOf(cmd));
    return JSON.stringify({ ok: true, nodeIds: created });
  };

  const connectNodes = async (cmd: WorkflowToolCall) => {
    const sourceNodeId = String(cmd.arguments?.sourceNodeId || '');
    const targetNodeId = String(cmd.arguments?.targetNodeId || '');
    if (!sourceNodeId || !targetNodeId) return JSON.stringify({ error: 'source/target required' });
    const nodes = deps.getNodes();
    const src = nodes.find((n) => n.id === sourceNodeId);
    const tgt = nodes.find((n) => n.id === targetNodeId);
    if (!src || !tgt) return JSON.stringify({ error: 'node not found' });
    const defaults = defaultHandles(String(src.type || ''), String(tgt.type || ''));
    const sourceHandle =
      typeof cmd.arguments?.sourceHandle === 'string' && cmd.arguments.sourceHandle
        ? String(cmd.arguments.sourceHandle)
        : defaults.sourceHandle;
    const targetHandle =
      typeof cmd.arguments?.targetHandle === 'string' && cmd.arguments.targetHandle
        ? String(cmd.arguments.targetHandle)
        : defaults.targetHandle;
    const exists = deps
      .getEdges()
      .some(
        (e) =>
          e.source === sourceNodeId &&
          e.target === targetNodeId &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle
      );
    if (!exists) {
      deps.addEdges({
        id: `edge_${sourceNodeId}_to_${targetNodeId}_${Date.now()}`,
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle,
        targetHandle,
        type: 'default',
        animated: true,
      });
      deps.saveState();
      void deps.persistWorkflow();
    }
    return JSON.stringify({ ok: true, sourceNodeId, targetNodeId, sourceHandle, targetHandle });
  };

  const configureNode = async (cmd: WorkflowToolCall) => {
    const nodeId = String(cmd.arguments?.nodeId || '');
    if (!nodeId) return JSON.stringify({ error: 'nodeId required' });
    const n = deps.getNodes().find((x) => x.id === nodeId);
    if (!n) return JSON.stringify({ error: 'node not found' });
    const patch: Record<string, unknown> = {};
    if (typeof cmd.arguments?.model === 'string' && cmd.arguments.model) {
      patch.model = cmd.arguments.model;
      patch.selectedModel = cmd.arguments.model;
    }
    if (typeof cmd.arguments?.aspectRatio === 'string' && cmd.arguments.aspectRatio)
      patch.aspectRatio = cmd.arguments.aspectRatio;
    if (typeof cmd.arguments?.resolution === 'string' && cmd.arguments.resolution) {
      patch.resolution = cmd.arguments.resolution;
      // Dream 节点用 quality 表示 1K/2K/4K
      if (n.type === 'dream') patch.quality = cmd.arguments.resolution;
    }
    if (typeof cmd.arguments?.quality === 'string' && cmd.arguments.quality) {
      patch.quality = cmd.arguments.quality;
      if (n.type === 'dream' && !patch.resolution) patch.resolution = cmd.arguments.quality;
    }
    if (cmd.arguments?.numImages != null && Number.isFinite(Number(cmd.arguments.numImages))) {
      patch.numImages = Math.max(1, Math.min(8, Number(cmd.arguments.numImages)));
    }
    if (typeof cmd.arguments?.provider === 'string' && cmd.arguments.provider) {
      patch.provider = cmd.arguments.provider;
    }
    if (cmd.arguments?.durationSeconds != null && Number.isFinite(Number(cmd.arguments.durationSeconds))) {
      patch.durationSeconds = Number(cmd.arguments.durationSeconds);
      patch.durationManual = Number(cmd.arguments.durationSeconds);
    }
    if (cmd.arguments?.skillId != null && Number.isFinite(Number(cmd.arguments.skillId))) {
      patch.skillId = Number(cmd.arguments.skillId);
    }
    if (n.type === 'prompt' && typeof cmd.arguments?.promptText === 'string') {
      patch.text = cmd.arguments.promptText;
    }
    patchNodeData(nodeId, patch);
    deps.saveState();
    void deps.persistWorkflow();
    if (msgOf(cmd)) ElMessage.info(msgOf(cmd));
    return JSON.stringify({ ok: true, nodeId, patch });
  };

  const createImagePipeline = async (cmd: WorkflowToolCall) => {
    const promptText = promptOf(cmd);
    if (!promptText) return JSON.stringify({ error: 'promptText required' });

    const refIds = Array.isArray(cmd.arguments?.referenceNodeIds)
      ? (cmd.arguments!.referenceNodeIds as unknown[]).map(String)
      : [];

    // 仅批量分镜等「显式只要出图」场景走 headless；其它正常建 Prompt+Dream
    const imagesOnly =
      cmd.arguments?.presentation === 'images_only' ||
      cmd.arguments?.uiMode === 'images_only' ||
      cmd.arguments?.batchImagesOnly === true ||
      cmd.arguments?.batch === true;

    if (imagesOnly) {
      const pendingJobs = listHeadlessImageJobs().filter((j) => j.status === 'pending');
      const panelIndex =
        cmd.arguments?.panelIndex != null && Number.isFinite(Number(cmd.arguments.panelIndex))
          ? Math.max(1, Number(cmd.arguments.panelIndex))
          : pendingJobs.length + 1;
      const sourceDream =
        (typeof cmd.arguments?.sourceDreamNodeId === 'string' && cmd.arguments.sourceDreamNodeId) ||
        (typeof cmd.arguments?.dreamNodeId === 'string' && cmd.arguments.dreamNodeId) ||
        (typeof cmd.arguments?.sourceNodeId === 'string' && cmd.arguments.sourceNodeId) ||
        undefined;
      const job = registerHeadlessImageJob({
        promptText,
        model: typeof cmd.arguments?.model === 'string' ? cmd.arguments.model : undefined,
        aspectRatio: typeof cmd.arguments?.aspectRatio === 'string' ? cmd.arguments.aspectRatio : undefined,
        resolution: typeof cmd.arguments?.resolution === 'string' ? cmd.arguments.resolution : undefined,
        quality: typeof cmd.arguments?.quality === 'string' ? cmd.arguments.quality : undefined,
        numImages:
          cmd.arguments?.numImages != null && Number.isFinite(Number(cmd.arguments.numImages))
            ? Number(cmd.arguments.numImages)
            : 1,
        referenceNodeIds: refIds,
        panelIndex,
        sourceDreamNodeId: sourceDream || undefined,
        skillId:
          cmd.arguments?.skillId != null && Number.isFinite(Number(cmd.arguments.skillId))
            ? Number(cmd.arguments.skillId)
            : undefined,
      });
      assignStripAnchors([...pendingJobs, job], {
        getNodes: deps.getNodes,
        getEdges: deps.getEdges,
        addNodes: deps.addNodes,
        addEdges: deps.addEdges,
        NODE_DIMENSIONS: deps.NODE_DIMENSIONS,
        getViewport: deps.getViewport,
        saveState: deps.saveState,
        persistWorkflow: deps.persistWorkflow,
      });

      const autoOk = authRun.canAutoExecute();
      if (autoOk) {
        void runHeadlessImageJob(job.id, {
          getNodes: deps.getNodes,
          getEdges: deps.getEdges,
          addNodes: deps.addNodes,
          addEdges: deps.addEdges,
          NODE_DIMENSIONS: deps.NODE_DIMENSIONS,
          getViewport: deps.getViewport,
          saveState: deps.saveState,
          persistWorkflow: deps.persistWorkflow,
          getTemplateId: deps.getTemplateId,
        });
        ElMessage.success(msgOf(cmd) || `授权回合内：镜 ${job.panelIndex} 开始生成（只落图片）`);
      } else {
        authRun.addPendingJob(job.id);
        ElMessage.info(
          msgOf(cmd) ||
            `已登记批量出图任务（镜 ${job.panelIndex}，不建编排节点），请 propose_generate 后点「确认并生成」`
        );
      }
      return JSON.stringify({
        ok: true,
        jobId: job.id,
        panelIndex: job.panelIndex,
        presentation: 'images_only',
        pendingConfirm: !autoOk,
        autoExecuteOnce: autoOk,
        referenceNodeIds: refIds,
      });
    }

    // —— 默认：正常创建 Prompt + Dream ——
    const prevZoom: number = (deps.getViewport() as any)?.zoom ?? 0.8;
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const promptId = `prompt_node_gemini_${stamp}`;
    const dreamId = `dream_node_gemini_${stamp}`;
    const promptPos = deps.calculateOptimalPosition('prompt');
    const dreamPreferred = {
      x: promptPos.x + (deps.NODE_DIMENSIONS.prompt?.width || 360) + deps.HORIZONTAL_PADDING,
      y: promptPos.y,
    };
    const dreamPos = deps.calculateOptimalPosition('dream', dreamPreferred);
    const dreamData: Record<string, unknown> = {};
    if (typeof cmd.arguments?.model === 'string' && cmd.arguments.model) {
      dreamData.model = cmd.arguments.model;
      dreamData.selectedModel = cmd.arguments.model;
    }
    if (typeof cmd.arguments?.aspectRatio === 'string' && cmd.arguments.aspectRatio)
      dreamData.aspectRatio = cmd.arguments.aspectRatio;
    if (typeof cmd.arguments?.resolution === 'string' && cmd.arguments.resolution) {
      dreamData.resolution = cmd.arguments.resolution;
      dreamData.quality = cmd.arguments.resolution;
    }
    if (typeof cmd.arguments?.quality === 'string' && cmd.arguments.quality) {
      dreamData.quality = cmd.arguments.quality;
      if (!dreamData.resolution) dreamData.resolution = cmd.arguments.quality;
    }
    if (cmd.arguments?.numImages != null && Number.isFinite(Number(cmd.arguments.numImages))) {
      dreamData.numImages = Math.max(1, Math.min(8, Number(cmd.arguments.numImages)));
    }
    if (cmd.arguments?.skillId != null && Number.isFinite(Number(cmd.arguments.skillId))) {
      dreamData.skillId = Number(cmd.arguments.skillId);
    }

    const newNodeQuota = authRun.consumeNewGenNode();
    if (!newNodeQuota.ok && newNodeQuota.reason) {
      ElMessage.warning(newNodeQuota.reason);
    }
    deps.addNodes({ id: promptId, type: 'prompt', position: promptPos, data: { text: promptText } });
    deps.addNodes({ id: dreamId, type: 'dream', position: dreamPos, data: dreamData });
    deps.addEdges({
      id: `edge_${promptId}_to_${dreamId}_${stamp}`,
      source: promptId,
      target: dreamId,
      sourceHandle: 'prompt-source',
      targetHandle: 'target',
      type: 'default',
      animated: true,
    });
    for (const rid of refIds) {
      if (!deps.getNodes().some((n) => n.id === rid)) continue;
      deps.addEdges({
        id: `edge_${rid}_to_${dreamId}_${stamp}`,
        source: rid,
        target: dreamId,
        sourceHandle: 'image-source',
        targetHandle: 'target',
        type: 'default',
        animated: true,
      });
    }

    await afterLayout(prevZoom);
    ElMessage.success(msgOf(cmd) || '已自动创建并连接生图节点；请 propose_generate，由用户确认后再生成。');
    return JSON.stringify({
      ok: true,
      promptId,
      dreamId,
      referenceNodeIds: refIds,
      presentation: 'full',
    });
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
    const videoData: Record<string, unknown> = {};
    if (cmd.arguments?.skillId != null && Number.isFinite(Number(cmd.arguments.skillId))) {
      videoData.skillId = Number(cmd.arguments.skillId);
    }
    if (typeof cmd.arguments?.provider === 'string' && cmd.arguments.provider) {
      videoData.provider = cmd.arguments.provider;
    }
    if (typeof cmd.arguments?.aspectRatio === 'string' && cmd.arguments.aspectRatio) {
      videoData.aspectRatio = cmd.arguments.aspectRatio;
    }
    if (typeof cmd.arguments?.resolution === 'string' && cmd.arguments.resolution) {
      videoData.resolution = cmd.arguments.resolution;
    }
    if (cmd.arguments?.durationSeconds != null && Number.isFinite(Number(cmd.arguments.durationSeconds))) {
      videoData.durationSeconds = Number(cmd.arguments.durationSeconds);
      videoData.durationManual = Number(cmd.arguments.durationSeconds);
    }
    const newNodeQuota = authRun.consumeNewGenNode();
    if (!newNodeQuota.ok && newNodeQuota.reason) {
      ElMessage.warning(newNodeQuota.reason);
    }
    deps.addNodes({ id: promptId, type: 'prompt', position: promptPos, data: { text: promptText } });
    deps.addNodes({ id: videoId, type: 'video', position: videoPos, data: videoData });
    deps.addEdges({
      id: `edge_${promptId}_to_${videoId}_${Date.now()}`,
      source: promptId,
      target: videoId,
      sourceHandle: 'prompt-source',
      targetHandle: 'target',
      type: 'default',
      animated: true,
    });

    const refIds = Array.isArray(cmd.arguments?.referenceNodeIds)
      ? (cmd.arguments!.referenceNodeIds as unknown[]).map(String)
      : [];
    const parseImageTs = (nodeId: string): number => {
      const m = nodeId.match(/^image_node_(\d+)_/);
      return m ? Number(m[1]) : 0;
    };
    const allNodes = deps.getNodes();
    const allEdges = deps.getEdges();
    let imageNodesToConnect = refIds
      .map((id) => allNodes.find((n) => n.id === id && n.type === 'image'))
      .filter(Boolean) as any[];
    if (!imageNodesToConnect.length) {
      const imgs = allNodes.filter((n) => n.type === 'image' && typeof (n.data as any)?.imageUrl === 'string');
      const maxTs = Math.max(...imgs.map((n) => parseImageTs(n.id)), 0);
      imageNodesToConnect = maxTs ? imgs.filter((n) => parseImageTs(n.id) === maxTs) : [];
    }
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
    ElMessage.success(msgOf(cmd) || '已自动创建并连接视频节点；请 propose_generate，由用户确认后再生成。');
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
    const jobId =
      typeof cmd.arguments?.jobId === 'string'
        ? cmd.arguments.jobId
        : typeof cmd.arguments?.nodeId === 'string' && String(cmd.arguments.nodeId).startsWith('img_job_')
          ? String(cmd.arguments.nodeId)
          : '';

    // headless job：不碰 Dream 节点
    if (jobId) {
      const job = getHeadlessImageJob(jobId);
      if (!job) return JSON.stringify({ error: 'job not found', jobId });
      const autoOk = authRun.canAutoExecute();
      if (autoOk) {
        void runHeadlessImageJob(jobId, {
          getNodes: deps.getNodes,
          getEdges: deps.getEdges,
          addNodes: deps.addNodes,
          addEdges: deps.addEdges,
          NODE_DIMENSIONS: deps.NODE_DIMENSIONS,
          getViewport: deps.getViewport,
          saveState: deps.saveState,
          persistWorkflow: deps.persistWorkflow,
          getTemplateId: deps.getTemplateId,
        });
        ElMessage.success(msgOf(cmd) || `授权回合内：任务 ${jobId} 将开始生成`);
      } else {
        authRun.addPendingJob(jobId);
        ElMessage.info(msgOf(cmd) || `已挂起出图任务（镜 ${job.panelIndex ?? '?'}），请点「确认并生成」`);
      }
      return JSON.stringify({
        ok: true,
        jobId,
        panelIndex: job.panelIndex,
        pendingConfirm: !autoOk,
        autoExecuteOnce: autoOk,
        presentation: 'images_only',
      });
    }

    const nodeId = typeof cmd.arguments?.nodeId === 'string' ? cmd.arguments.nodeId : '';
    if (!nodeId) return JSON.stringify({ error: 'nodeId or jobId required' });
    const n = deps.getNodes().find((x) => x.id === nodeId);
    if (!n || (n.type !== 'dream' && n.type !== 'video')) {
      return JSON.stringify({ error: 'dream/video node not found' });
    }

    const autoOk = authRun.canAutoExecute();
    patchNodeData(nodeId, {
      proposeGenerate: true,
      proposeMessage: msgOf(cmd),
      ...(autoOk ? { autoExecuteOnce: true } : { autoExecuteOnce: false }),
    });
    authRun.addPendingPropose(nodeId);
    deps.saveState();
    void deps.persistWorkflow();
    if (autoOk) {
      ElMessage.success(msgOf(cmd) || `授权回合内：节点 ${nodeId} 将自动开始生成`);
    } else {
      ElMessage.info(msgOf(cmd) || `已挂起节点 ${nodeId}，请在聊天中点击「确认并生成」`);
    }
    return JSON.stringify({
      ok: true,
      nodeId,
      pendingConfirm: !autoOk,
      autoExecuteOnce: autoOk,
    });
  };

  /** 兼容旧入口：只处理 create_* intent */
  const executeGeminiCommand = async (cmd: any) => {
    await execute(cmd);
  };

  return { execute, executeGeminiCommand };
}
