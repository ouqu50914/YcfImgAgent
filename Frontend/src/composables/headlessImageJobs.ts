/**
 * Agent 批量生图：不创建 Prompt/Dream 节点，确认后直接落 Image 节点。
 */
import { ElMessage } from 'element-plus';
import { generateImage } from '@/api/image';
import { createImageGenerationKey } from '@/utils/generation-key';
import { getUploadUrl, toPersistableImageUrl } from '@/utils/image-loader';
import { useAgentAuthorizedRun } from '@/composables/useAgentAuthorizedRun';

export type HeadlessImageJob = {
  id: string;
  promptText: string;
  model?: string;
  aspectRatio?: string;
  quality?: string;
  resolution?: string;
  numImages: number;
  referenceNodeIds: string[];
  panelIndex?: number;
  outputAnchor?: { x: number; y: number };
  skillId?: number;
  /** 同批分镜共享，写入同一个图片集合节点 */
  batchId?: string;
  collectionNodeId?: string;
  /** 追源：连到哪个 Dream（生图节点） */
  sourceDreamNodeId?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
};

export type HeadlessCanvasDeps = {
  getNodes: () => any[];
  getEdges?: () => any[];
  addNodes: (n: any) => void;
  addEdges?: (e: any) => void;
  NODE_DIMENSIONS: Record<string, { width: number; height: number }>;
  getViewport: () => any;
  saveState: () => void;
  persistWorkflow: () => void | Promise<unknown>;
  getTemplateId?: () => number | null | undefined;
};

export type ImageCollectionItemData = {
  key: string;
  panelIndex: number;
  panelLabel?: string;
  prompt?: string;
  imageUrl?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  generationKey?: string;
};

const jobs = new Map<string, HeadlessImageJob>();
/** 当前开放中的批量登记批次（pending 期间复用） */
let openBatchId: string | null = null;
/** 集合节点写入串行化，避免并行回填丢槽 */
const collectionWriteChain = new Map<string, Promise<unknown>>();

function withCollectionLock(collectionId: string, fn: () => void): Promise<void> {
  const prev = collectionWriteChain.get(collectionId) || Promise.resolve();
  const next = prev.then(() => {
    fn();
  });
  collectionWriteChain.set(
    collectionId,
    next.catch(() => undefined)
  );
  return next;
}

export function getHeadlessImageJob(id: string): HeadlessImageJob | undefined {
  return jobs.get(id);
}

export function listHeadlessImageJobs(): HeadlessImageJob[] {
  return Array.from(jobs.values());
}

export function clearFinishedHeadlessJobs() {
  for (const [id, j] of jobs) {
    if (j.status === 'done' || j.status === 'error') jobs.delete(id);
  }
}

function parseAliasNum(alias: unknown): number | null {
  if (typeof alias !== 'string') return null;
  const m = alias.match(/^图(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveApiType(model: string): 'dream' | 'nano' | 'midjourney' {
  if (model === 'midjourney') return 'midjourney';
  if (
    model === 'gpt-2.5'
    || model === 'gpt-2.5-pro'
    || model === 'gpt-2.0'
    || model === 'nano-2'
    || model === 'nano-pro'
    || model.startsWith('gpt-image-2')
    || model.startsWith('nano:')
    || model.startsWith('anyfast:')
  ) {
    return 'nano';
  }
  return 'dream';
}

function resolveNanoModel(model: string): string | undefined {
  if (model === 'gpt-2.5') return 'gpt-image-2.5-flare';
  if (model === 'gpt-2.5-pro') return 'gpt-image-2.5-sunburst';
  if (model === 'gpt-2.0') return 'gpt-image-2';
  if (model === 'nano-2') return 'nano-banana-2';
  if (model === 'nano-pro') return 'nano-banana-pro';
  if (model.startsWith('gpt-image-2')) return model.split(':')[0];
  if (!model.startsWith('nano:') && !model.startsWith('anyfast:')) return undefined;
  const parts = model.split(':');
  return parts.slice(1).join(':') || undefined;
}

function resolveProviderHint(model: string): 'ace' | 'anyfast' | undefined {
  // 产品线：不锁渠道，后端 AnyFast 优先 + Ace 兜底
  if (
    model === 'gpt-2.5'
    || model === 'gpt-2.5-pro'
    || model === 'gpt-2.0'
    || model === 'nano-2'
    || model === 'nano-pro'
  ) {
    return undefined;
  }
  if (model.endsWith(':ace') || model === 'gpt-image-2:ace') return 'ace';
  if (model.startsWith('gpt-image-2:') && model.includes('anyfast')) return 'anyfast';
  if (
    model.startsWith('gpt-image-2')
    || model.startsWith('anyfast:')
  ) {
    return 'anyfast';
  }
  if (model.startsWith('nano:')) return 'ace';
  return undefined;
}

function calculatePixelSize(aspectRatioValue: string, resolutionValue: string): { width: number; height: number } {
  const resolutionMap: Record<string, number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
    standard: 2048,
  };
  const baseSize = resolutionMap[resolutionValue] || 2048;
  const ratioMap: Record<string, { width: number; height: number }> = {
    '1:1': { width: baseSize, height: baseSize },
    '2:3': { width: Math.floor((baseSize * 2) / 3), height: baseSize },
    '3:2': { width: baseSize, height: Math.floor((baseSize * 2) / 3) },
    '3:4': { width: Math.floor((baseSize * 3) / 4), height: baseSize },
    '4:3': { width: baseSize, height: Math.floor((baseSize * 3) / 4) },
    '4:5': { width: Math.floor((baseSize * 4) / 5), height: baseSize },
    '5:4': { width: baseSize, height: Math.floor((baseSize * 4) / 5) },
    '9:16': { width: Math.floor((baseSize * 9) / 16), height: baseSize },
    '16:9': { width: baseSize, height: Math.floor((baseSize * 9) / 16) },
    '21:9': { width: baseSize, height: Math.floor((baseSize * 9) / 21) },
  };
  return ratioMap[aspectRatioValue] || { width: baseSize, height: baseSize };
}

function roundTo16(n: number): number {
  return Math.max(16, Math.round(n / 16) * 16);
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function calculateGptImage2Size(aspectRatioValue: string, qualityValue: string): string {
  const targetPixels = qualityValue === 'high' ? 4194304 : qualityValue === 'low' ? 1048576 : 3145728;
  const m = aspectRatioValue.match(/^(\d+):(\d+)$/);
  const ratio = clamp(m ? Number(m[1]) / Number(m[2]) : 1, 1 / 3, 3);
  let width = roundTo16(Math.sqrt(targetPixels * ratio));
  let height = roundTo16(width / ratio);
  width = clamp(width, 16, 3840);
  height = clamp(height, 16, 3840);
  return `${width}x${height}`;
}

function nextStripAnchor(deps: HeadlessCanvasDeps, panelIndex: number): { x: number; y: number } {
  const imgW = deps.NODE_DIMENSIONS.image?.width || 240;
  const gap = 36;
  const nodes = deps.getNodes().filter((n) => n.type === 'image' && !(n.data as any)?.uiRole);
  if (nodes.length) {
    const maxX = Math.max(...nodes.map((n) => n.position.x));
    const y = Math.min(...nodes.map((n) => n.position.y));
    // 同批多 job 并行时用 panelIndex 错开，避免叠在同一点
    return { x: maxX + imgW + gap + Math.max(0, panelIndex - 1) * (imgW + gap) * 0, y };
  }
  try {
    const vp = deps.getViewport() as { x?: number; y?: number; zoom?: number };
    const zoom = vp?.zoom || 0.8;
    return {
      x: (-(vp?.x || 0) + 80) / zoom + Math.max(0, panelIndex - 1) * (imgW + gap),
      y: (-(vp?.y || 0) + 100) / zoom,
    };
  } catch {
    return { x: 120 + Math.max(0, panelIndex - 1) * (imgW + gap), y: 80 };
  }
}

function resolveDefaultModel(deps: HeadlessCanvasDeps, explicit?: string): string {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const dream = deps.getNodes().find((n) => n.type === 'dream');
  const d = dream?.data as any;
  if (typeof d?.selectedModel === 'string' && d.selectedModel) return d.selectedModel;
  if (typeof d?.model === 'string' && d.model) {
    if (d.providerHint === 'anyfast') return `anyfast:${d.model}`;
    if (String(d.model).startsWith('nano') || String(d.model).startsWith('gemini')) return `nano:${d.model}`;
    return d.model;
  }
  return 'nano-2';
}

export function registerHeadlessImageJob(
  input: Omit<HeadlessImageJob, 'id' | 'status'> & { id?: string }
): HeadlessImageJob {
  const id = input.id || `img_job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pending = listHeadlessImageJobs().filter((j) => j.status === 'pending');
  if (!openBatchId || pending.length === 0) {
    openBatchId = `storyboard_batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
  const job: HeadlessImageJob = {
    ...input,
    id,
    batchId: input.batchId || openBatchId,
    numImages: Math.max(1, Math.min(8, Math.floor(Number(input.numImages) || 1))),
    referenceNodeIds: Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.map(String) : [],
    status: 'pending',
  };
  jobs.set(id, job);
  return job;
}

function jobsInBatch(batchId: string): HeadlessImageJob[] {
  return listHeadlessImageJobs().filter((j) => j.batchId === batchId);
}

function resolveSourceDreamId(deps: HeadlessCanvasDeps, job: HeadlessImageJob): string | null {
  const nodes = deps.getNodes();
  const explicit = String(job.sourceDreamNodeId || '').trim();
  if (explicit && nodes.some((n) => n.id === explicit && n.type === 'dream')) {
    return explicit;
  }
  const dreams = nodes.filter((n) => n.type === 'dream');
  if (!dreams.length) return null;
  const edges = deps.getEdges?.() || [];
  if (job.referenceNodeIds?.length) {
    const hit = dreams.find((d) =>
      edges.some((e) => e.target === d.id && job.referenceNodeIds.includes(String(e.source)))
    );
    if (hit) return hit.id;
  }
  return dreams[0]?.id || null;
}

function ensureDreamToCollectionEdge(deps: HeadlessCanvasDeps, dreamId: string, collectionId: string) {
  if (!deps.addEdges) return;
  const edges = deps.getEdges?.() || [];
  if (edges.some((e) => e.source === dreamId && e.target === collectionId)) return;
  deps.addEdges({
    id: `edge_${dreamId}_to_${collectionId}_${Date.now()}`,
    source: dreamId,
    target: collectionId,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'default',
    animated: true,
  });
}

function collectionAnchor(deps: HeadlessCanvasDeps): { x: number; y: number } {
  const visible = deps
    .getNodes()
    .filter((n) => n.type === 'image' || n.type === 'prompt' || n.type === 'dream' || n.type === 'videoRef');
  if (visible.length) {
    const maxX = Math.max(
      ...visible.map((n) => n.position.x + (deps.NODE_DIMENSIONS[n.type || '']?.width || 240))
    );
    const minY = Math.min(...visible.map((n) => n.position.y));
    return { x: maxX + 80, y: minY };
  }
  return nextStripAnchor(deps, 1);
}

function patchCollectionItems(
  deps: HeadlessCanvasDeps,
  collectionNodeId: string,
  mutator: (items: ImageCollectionItemData[]) => ImageCollectionItemData[]
) {
  const n = deps.getNodes().find((x) => x.id === collectionNodeId);
  if (!n) return;
  const prev = Array.isArray((n.data as any)?.items)
    ? ([...(n.data as any).items] as ImageCollectionItemData[])
    : [];
  const next = mutator(prev);
  n.data = {
    ...(n.data || {}),
    items: next,
    title: `分镜集合 · ${next.length} 镜`,
  };
}

async function upsertCollectionSlot(
  deps: HeadlessCanvasDeps,
  collectionNodeId: string,
  patch: ImageCollectionItemData
) {
  await withCollectionLock(collectionNodeId, () => {
    patchCollectionItems(deps, collectionNodeId, (items) => {
      // 只按 key 更新，避免 panelIndex 碰撞把别的镜盖掉
      const idx = items.findIndex((it) => it.key === patch.key);
      if (idx >= 0) {
        const next = [...items];
        next[idx] = { ...next[idx]!, ...patch, panelIndex: next[idx]!.panelIndex || patch.panelIndex };
        return next.sort((a, b) => a.panelIndex - b.panelIndex);
      }
      return [...items, patch].sort((a, b) => a.panelIndex - b.panelIndex);
    });
  });
}

/** 确认前：规范化镜号并一次性建好集合全部槽位，再并行出图 */
export function prepareHeadlessBatch(jobIds: string[], deps: HeadlessCanvasDeps): string | null {
  const list = jobIds
    .map((id) => jobs.get(id))
    .filter((j): j is HeadlessImageJob => !!j && (j.status === 'pending' || j.status === 'error'));
  if (!list.length) return null;

  // 唯一递增镜号，防止 Agent 漏传/重复 panelIndex 导致少槽
  const sorted = [...list].sort((a, b) => {
    const pa = a.panelIndex && a.panelIndex > 0 ? a.panelIndex : 9999;
    const pb = b.panelIndex && b.panelIndex > 0 ? b.panelIndex : 9999;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });
  sorted.forEach((j, i) => {
    j.panelIndex = i + 1;
  });

  const collectionId = ensureCollectionNode(deps, sorted[0]!);
  for (const j of sorted) {
    j.collectionNodeId = collectionId;
    // 同步占位（不走 async lock 链的首帧）
    patchCollectionItems(deps, collectionId, (items) => {
      if (items.some((it) => it.key === j.id)) {
        return items.map((it) =>
          it.key === j.id
            ? {
                ...it,
                panelIndex: j.panelIndex || it.panelIndex,
                panelLabel: `镜 ${j.panelIndex}`,
                prompt: j.promptText,
              }
            : it
        );
      }
      return [
        ...items,
        {
          key: j.id,
          panelIndex: j.panelIndex || 1,
          panelLabel: `镜 ${j.panelIndex}`,
          prompt: j.promptText,
          imageUrl: '',
          isLoading: false,
        },
      ].sort((a, b) => a.panelIndex - b.panelIndex);
    });
  }
  deps.saveState();
  void deps.persistWorkflow();
  return collectionId;
}

/** 确保同批有一个图片集合节点，并按 panel 序建好槽位；尽量挂在生图节点右侧并连线追源 */
function ensureCollectionNode(deps: HeadlessCanvasDeps, job: HeadlessImageJob): string {
  const batchId = job.batchId || job.id;
  const nodeId = `image_collection_${batchId}`;
  const existing = deps.getNodes().find(
    (n) =>
      n.id === nodeId ||
      (n.type === 'imageCollection' && (n.data as any)?.batchId === batchId)
  );
  const batchJobs = jobsInBatch(batchId).sort(
    (a, b) => (a.panelIndex || 0) - (b.panelIndex || 0)
  );
  batchJobs.forEach((j, i) => {
    if (!j.panelIndex || j.panelIndex < 1) j.panelIndex = i + 1;
  });

  const dreamId = resolveSourceDreamId(deps, job);
  if (dreamId) {
    job.sourceDreamNodeId = dreamId;
    for (const j of batchJobs) {
      if (!j.sourceDreamNodeId) j.sourceDreamNodeId = dreamId;
    }
  }

  const buildItems = (prev: ImageCollectionItemData[] = []): ImageCollectionItemData[] => {
    const byKey = new Map(prev.map((it) => [it.key, it]));
    for (const j of batchJobs) {
      if (byKey.has(j.id)) continue;
      byKey.set(j.id, {
        key: j.id,
        panelIndex: j.panelIndex || 1,
        panelLabel: `镜 ${j.panelIndex || 1}`,
        prompt: j.promptText,
        imageUrl: '',
        isLoading: false,
      });
    }
    return Array.from(byKey.values()).sort((a, b) => a.panelIndex - b.panelIndex);
  };

  const positionBesideDream = (): { x: number; y: number } => {
    if (dreamId) {
      const dream = deps.getNodes().find((n) => n.id === dreamId);
      if (dream) {
        const w = deps.NODE_DIMENSIONS.dream?.width || 400;
        return { x: dream.position.x + w + 80, y: dream.position.y };
      }
    }
    return job.outputAnchor || collectionAnchor(deps);
  };

  if (existing) {
    job.collectionNodeId = existing.id;
    for (const j of batchJobs) j.collectionNodeId = existing.id;
    patchCollectionItems(deps, existing.id, (items) => buildItems(items));
    if (dreamId) {
      existing.data = {
        ...(existing.data || {}),
        fromNodeId: dreamId,
        sourceDreamNodeId: dreamId,
      };
      ensureDreamToCollectionEdge(deps, dreamId, existing.id);
    }
    deps.saveState();
    void deps.persistWorkflow();
    return existing.id;
  }

  const items = buildItems();
  deps.addNodes({
    id: nodeId,
    type: 'imageCollection',
    position: positionBesideDream(),
    data: {
      title: `分镜集合 · ${items.length} 镜`,
      batchId,
      items,
      ...(dreamId ? { fromNodeId: dreamId, sourceDreamNodeId: dreamId } : {}),
    },
  });
  job.collectionNodeId = nodeId;
  for (const j of batchJobs) j.collectionNodeId = nodeId;
  if (dreamId) ensureDreamToCollectionEdge(deps, dreamId, nodeId);
  deps.saveState();
  void deps.persistWorkflow();
  return nodeId;
}

function collectRefs(deps: HeadlessCanvasDeps, refIds: string[], sourceDreamId?: string): { urls: string[]; aliases: number[] } {
  const nodes = deps.getNodes();
  const edges = deps.getEdges?.() || [];
  const urls: string[] = [];
  const aliases: number[] = [];

  const pushNode = (n: any) => {
    const url = n?.data?.imageUrl;
    if (typeof url !== 'string' || !url) return;
    if (urls.includes(url)) return;
    urls.push(url);
    aliases.push(parseAliasNum((n.data as any)?.imageAlias) ?? aliases.length + 1);
  };

  for (const rid of refIds) {
    const n = nodes.find((x) => x.id === rid && x.type === 'image');
    if (n) pushNode(n);
  }
  if (urls.length) return { urls, aliases };

  // 未指定时：优先取连到源 Dream 的参考图（身份锚点）
  if (sourceDreamId) {
    for (const e of edges) {
      if (e.target !== sourceDreamId) continue;
      const n = nodes.find((x) => x.id === e.source && x.type === 'image');
      if (n) pushNode(n);
    }
    if (urls.length) return { urls, aliases };
  }

  // 再用「看起来像参考图」的节点（无上游生成来源）
  const imgs = nodes.filter(
    (n) =>
      n.type === 'image' &&
      typeof n.data?.imageUrl === 'string' &&
      n.data.imageUrl &&
      !(n.data as any)?.isLoading &&
      !(n.data as any)?.fromHeadlessJob &&
      !(n.data as any)?.fromNodeId
  );
  for (const n of imgs) pushNode(n);
  return { urls, aliases };
}

function buildRequestParams(job: HeadlessImageJob, model: string, refs: { urls: string[]; aliases: number[] }) {
  const apiType = resolveApiType(model);
  const aspectRatio = job.aspectRatio || '1:1';
  let quality = job.quality || job.resolution || (apiType === 'nano' ? '2K' : '2K');
  const isGpt = model === 'gpt-2.5' || model === 'gpt-2.5-pro' || model === 'gpt-2.0' || model.startsWith('gpt-image-2');
  const isGemini3Pro = model === 'anyfast:gemini-3-pro-image';

  const processed = refs.urls.map((u) => getUploadUrl(u));
  const hasMulti = processed.length > 1;
  const requestParams: Record<string, unknown> = {
    apiType,
    prompt: job.promptText || '基于参考图片生成',
    numImages: job.numImages,
    imageUrl: hasMulti ? undefined : processed[0] || undefined,
    imageUrls: hasMulti && processed.length ? processed : undefined,
  };
  if (processed.length && refs.aliases.length) {
    requestParams.imageAliases = refs.aliases.slice(0, processed.length);
  }

  if (apiType === 'dream') {
    const { width, height } = calculatePixelSize(aspectRatio, quality === 'standard' ? 'standard' : quality);
    const sizeInfo = `${aspectRatio}比例、${quality === 'standard' ? '标准' : quality}分辨率的图片，尺寸为${width}x${height}像素`;
    const prompt = String(requestParams.prompt);
    if (!prompt.includes('比例') && !prompt.includes('分辨率') && !prompt.includes('像素')) {
      requestParams.prompt = `${prompt}，生成一个${sizeInfo}`;
    }
    requestParams.width = width;
    requestParams.height = height;
    if (quality !== 'standard') requestParams.quality = quality;
  } else if (apiType === 'nano') {
    requestParams.aspectRatio = aspectRatio;
    if (isGemini3Pro) quality = '4K';
    if (isGpt) {
      const normalizedQ = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
      requestParams.quality = normalizedQ;
      requestParams.size = calculateGptImage2Size(aspectRatio, normalizedQ);
      requestParams.outputFormat = 'png';
      requestParams.moderation = 'auto';
    } else if (quality) {
      requestParams.quality = quality;
    }
    const nm = resolveNanoModel(model);
    if (nm) requestParams.model = nm;
    const ph = resolveProviderHint(model);
    if (ph) requestParams.providerHint = ph;
  } else if (apiType === 'midjourney') {
    requestParams.mode = 'fast';
    requestParams.translation = true;
    requestParams.timeout = 120;
    requestParams.splitImages = true;
    requestParams.mjAction = 'generate';
    requestParams.model = 'midjourney';
    requestParams.aspectRatio = aspectRatio;
    if (quality) requestParams.quality = quality;
  }

  return requestParams;
}

/** 执行单个 headless job：写入同批「图片集合」节点槽位 */
export async function runHeadlessImageJob(
  jobId: string,
  deps: HeadlessCanvasDeps
): Promise<{ ok: boolean; collectionNodeId?: string; error?: string }> {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'job not found' };
  if (job.status === 'running') return { ok: false, error: 'job already running' };
  if (job.status === 'done') return { ok: true, collectionNodeId: job.collectionNodeId };

  const authRun = useAgentAuthorizedRun();
  const consumed = authRun.consumeGenerate(job.numImages);
  if (!consumed.ok) {
    job.status = 'error';
    job.error = consumed.reason || '授权额度不足';
    return { ok: false, error: job.error };
  }

  job.status = 'running';
  const model = resolveDefaultModel(deps, job.model);
  const dreamId = resolveSourceDreamId(deps, job);
  if (dreamId) job.sourceDreamNodeId = dreamId;
  const refs = collectRefs(deps, job.referenceNodeIds, dreamId || undefined);
  const panelIndex = job.panelIndex && job.panelIndex >= 1 ? job.panelIndex : 1;
  job.panelIndex = panelIndex;
  const generationKey = createImageGenerationKey();
  const collectionNodeId = job.collectionNodeId || ensureCollectionNode(deps, job);

  await upsertCollectionSlot(deps, collectionNodeId, {
    key: job.id,
    panelIndex,
    panelLabel: `镜 ${panelIndex}`,
    prompt: job.promptText,
    imageUrl: '',
    isLoading: true,
    isError: false,
    generationKey,
  });
  deps.saveState();
  void deps.persistWorkflow();

  try {
    const requestParams = buildRequestParams(job, model, refs) as any;
    requestParams.generationKey = generationKey;
    const tid = deps.getTemplateId?.();
    if (tid != null && tid > 0) requestParams.templateId = tid;

    const res: any = await generateImage(requestParams);
    const allImages: string[] = res?.data?.all_images || (res?.data?.image_url ? [res.data.image_url] : []);
    if (!allImages.length) {
      throw new Error(res?.message || '生成未返回图片');
    }

    const src = allImages[0]!;
    const persistable = toPersistableImageUrl(src) || src;
    await upsertCollectionSlot(deps, collectionNodeId, {
      key: job.id,
      panelIndex,
      panelLabel: `镜 ${panelIndex}`,
      prompt: job.promptText,
      imageUrl: persistable,
      isLoading: false,
      isError: false,
      generationKey,
    });

    job.status = 'done';
    if (!listHeadlessImageJobs().some((j) => j.batchId === job.batchId && j.status === 'pending')) {
      openBatchId = null;
    }
    deps.saveState();
    void deps.persistWorkflow();
    ElMessage.success(`镜 ${panelIndex} 已写入分镜集合`);
    return { ok: true, collectionNodeId };
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || '生成失败';
    job.status = 'error';
    job.error = msg;
    await upsertCollectionSlot(deps, collectionNodeId, {
      key: job.id,
      panelIndex,
      panelLabel: `镜 ${panelIndex}`,
      prompt: job.promptText,
      imageUrl: '',
      isLoading: false,
      isError: true,
      errorMessage: msg,
      generationKey,
    });
    deps.saveState();
    void deps.persistWorkflow();
    ElMessage.error(`镜 ${panelIndex} 失败：${msg}`);
    return { ok: false, error: msg, collectionNodeId };
  }
}

/** 同批共用一个集合落点（不再为每镜散落锚点） */
export function assignStripAnchors(jobList: HeadlessImageJob[], deps: HeadlessCanvasDeps) {
  if (!jobList.length) return;
  const shared = jobList.find((j) => j.outputAnchor)?.outputAnchor || collectionAnchor(deps);
  jobList.forEach((j, i) => {
    j.outputAnchor = shared;
    if (!j.panelIndex) j.panelIndex = i + 1;
  });
}
