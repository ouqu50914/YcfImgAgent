/**
 * Agent「确认并生成」：默认先挂起，用户点确认后再执行；可开启全自动跳过确认。
 * 不再做次数/张数/新节点硬上限（积分仍由后端扣费）。
 */
import { computed, ref } from 'vue';

const FULL_AUTO_KEY = 'artn.agentFullAutoGenerate';

export const AGENT_RUN_LIMITS = {
  /** @deprecated 保留字段以免旧 UI 报错；已不再作为硬限制 */
  maxGenerates: Number.POSITIVE_INFINITY,
  maxNewGenNodes: Number.POSITIVE_INFINITY,
  maxImages: Number.POSITIVE_INFINITY,
  durationMs: 60 * 60 * 1000,
} as const;

export type AuthorizedRunSnapshot = {
  active: boolean;
  startedAt: number;
  expiresAt: number;
  generatesUsed: number;
  imagesUsed: number;
  newNodesUsed: number;
  exhaustedReason: string | null;
};

type NodePatcher = (nodeId: string, patch: Record<string, unknown>) => void;
type JobRunner = (jobId: string) => unknown | Promise<unknown>;
type JobBatchPreparer = (jobIds: string[]) => unknown | Promise<unknown>;

const run = ref<AuthorizedRunSnapshot>({
  active: false,
  startedAt: 0,
  expiresAt: 0,
  generatesUsed: 0,
  imagesUsed: 0,
  newNodesUsed: 0,
  exhaustedReason: null,
});

const pendingProposeNodeIds = ref<string[]>([]);
const pendingProposeJobIds = ref<string[]>([]);
/** 全自动：propose 后立即执行，不再弹确认 */
const fullAutoGenerate = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(FULL_AUTO_KEY) === '1'
);

let nodePatcher: NodePatcher | null = null;
let jobRunner: JobRunner | null = null;
let jobBatchPreparer: JobBatchPreparer | null = null;
let onExhausted: ((reason: string) => void) | null = null;

export function registerAuthorizedRunNodePatcher(fn: NodePatcher | null) {
  nodePatcher = fn;
}

export function registerAuthorizedRunJobRunner(fn: JobRunner | null) {
  jobRunner = fn;
}

export function registerAuthorizedRunJobBatchPreparer(fn: JobBatchPreparer | null) {
  jobBatchPreparer = fn;
}

export function registerAuthorizedRunExhaustedHandler(fn: ((reason: string) => void) | null) {
  onExhausted = fn;
}

function isExpired(now = Date.now()): boolean {
  return run.value.active && now >= run.value.expiresAt;
}

function markExhausted(reason: string) {
  run.value = {
    ...run.value,
    active: false,
    exhaustedReason: reason,
  };
  onExhausted?.(reason);
}

export function useAgentAuthorizedRun() {
  const pendingCount = computed(
    () => pendingProposeNodeIds.value.length + pendingProposeJobIds.value.length
  );

  const statusLine = computed(() => {
    if (!run.value.active) {
      if (run.value.exhaustedReason) return run.value.exhaustedReason;
      return '';
    }
    return `生成执行中：已启动 ${run.value.generatesUsed} 次 · ${run.value.imagesUsed} 张`;
  });

  const refreshExpiry = () => {
    if (run.value.active && isExpired()) {
      markExhausted('本轮确认已超时，如需继续请再次确认并生成');
    }
  };

  const isRunActive = (): boolean => {
    refreshExpiry();
    return run.value.active;
  };

  /** 全自动，或用户已点「确认并生成」后的本轮执行窗口 */
  const canAutoExecute = (): boolean => {
    if (fullAutoGenerate.value) return true;
    return isRunActive();
  };

  const setFullAutoGenerate = (on: boolean) => {
    fullAutoGenerate.value = on;
    try {
      localStorage.setItem(FULL_AUTO_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const startRun = () => {
    const now = Date.now();
    run.value = {
      active: true,
      startedAt: now,
      expiresAt: now + AGENT_RUN_LIMITS.durationMs,
      generatesUsed: 0,
      imagesUsed: 0,
      newNodesUsed: 0,
      exhaustedReason: null,
    };
  };

  const endRun = (reason?: string) => {
    run.value = {
      ...run.value,
      active: false,
      exhaustedReason: reason || null,
    };
  };

  const addPendingPropose = (nodeId: string) => {
    const id = String(nodeId || '').trim();
    if (!id) return;
    if (!pendingProposeNodeIds.value.includes(id)) {
      pendingProposeNodeIds.value = [...pendingProposeNodeIds.value, id];
    }
  };

  const addPendingJob = (jobId: string) => {
    const id = String(jobId || '').trim();
    if (!id) return;
    if (!pendingProposeJobIds.value.includes(id)) {
      pendingProposeJobIds.value = [...pendingProposeJobIds.value, id];
    }
  };

  const removePendingPropose = (nodeId: string) => {
    pendingProposeNodeIds.value = pendingProposeNodeIds.value.filter((x) => x !== nodeId);
  };

  const removePendingJob = (jobId: string) => {
    pendingProposeJobIds.value = pendingProposeJobIds.value.filter((x) => x !== jobId);
  };

  const clearPendingProposes = () => {
    pendingProposeNodeIds.value = [];
    pendingProposeJobIds.value = [];
  };

  const confirmAndGenerate = (): {
    ok: boolean;
    nodeIds: string[];
    jobIds: string[];
    message: string;
  } => {
    const ids = [...pendingProposeNodeIds.value];
    const jobIds = [...pendingProposeJobIds.value];
    if (!ids.length && !jobIds.length) {
      return { ok: false, nodeIds: [], jobIds: [], message: '当前没有待确认的生成任务' };
    }
    startRun();
    for (const id of ids) {
      nodePatcher?.(id, {
        proposeGenerate: true,
        autoExecuteOnce: true,
      });
    }
    pendingProposeNodeIds.value = [];
    pendingProposeJobIds.value = [];
    void Promise.resolve(jobBatchPreparer?.(jobIds))
      .catch(() => undefined)
      .then(() => {
        for (const jid of jobIds) {
          void Promise.resolve(jobRunner?.(jid)).catch(() => undefined);
        }
      });
    return {
      ok: true,
      nodeIds: ids,
      jobIds,
      message: `已确认，开始生成 ${ids.length + jobIds.length} 项（将按实际结果扣费）`,
    };
  };

  /** 仅记账，不再因额度拒绝 */
  const consumeGenerate = (imageCount = 1): { ok: boolean; reason?: string } => {
    if (!fullAutoGenerate.value && !isRunActive()) {
      return { ok: false, reason: '请先确认生成，或开启「全自动生成」' };
    }
    const imgs = Math.max(1, Math.floor(Number(imageCount) || 1));
    run.value = {
      ...run.value,
      generatesUsed: run.value.generatesUsed + 1,
      imagesUsed: run.value.imagesUsed + imgs,
    };
    return { ok: true };
  };

  const consumeNewGenNode = (): { ok: boolean; reason?: string } => {
    if (run.value.active || fullAutoGenerate.value) {
      run.value = {
        ...run.value,
        newNodesUsed: run.value.newNodesUsed + 1,
      };
    }
    return { ok: true };
  };

  const authContextForAgent = (): string => {
    refreshExpiry();
    if (fullAutoGenerate.value) {
      return (
        '【全自动生成已开启】propose_generate / images_only 任务将立即执行并扣费。' +
        '仍须先编排完成再 propose；疑问句只回答或 ask_user，禁止 propose。'
      );
    }
    if (run.value.active) {
      return (
        '【用户已确认本轮生成】可继续 propose_generate 并自动执行。' +
        '禁止连环无意义重试；疑问句只回答或 ask_user。'
      );
    }
    return (
      '【当前需用户确认】propose_generate 只挂起待确认，不会自动扣费。' +
      '疑问句只回答或 ask_user，禁止 propose。明确要做时编排后 propose，等用户点「确认并生成」。'
    );
  };

  return {
    run,
    pendingProposeNodeIds,
    pendingProposeJobIds,
    pendingCount,
    statusLine,
    limits: AGENT_RUN_LIMITS,
    fullAutoGenerate,
    setFullAutoGenerate,
    isRunActive,
    canAutoExecute,
    startRun,
    endRun,
    addPendingPropose,
    addPendingJob,
    removePendingPropose,
    removePendingJob,
    clearPendingProposes,
    confirmAndGenerate,
    consumeGenerate,
    consumeNewGenNode,
    authContextForAgent,
    refreshExpiry,
  };
}
