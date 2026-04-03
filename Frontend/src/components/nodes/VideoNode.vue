<template>
  <div class="video-node">
    <div class="node-header">
      <el-icon><VideoCamera /></el-icon>
      <span>视频生成节点</span>
      <el-tag size="small" class="model-tag" effect="dark">
        {{ providerLabel }}
      </el-tag>
    </div>

    <div class="node-content">
      <!-- 上半部分：参数表单（nodrag：避免点击控件时触发节点拖拽） -->
      <div class="params-section nodrag">
        <div class="param-item">
          <div class="param-label">模型</div>
          <el-select v-model="provider" size="small" class="param-select">
            <!-- Kling 目前作为历史兼容分支存在：前端不允许新建选择 -->
            <el-option label="Seedance" value="seedance" />
            <el-option label="PixVerse" value="pixverse" />
            <el-option label="Kling(内部)" value="kling" disabled />
          </el-select>
        </div>

        <div v-if="provider === 'seedance'" class="param-item">
          <div class="param-label">Seedance 类型</div>
          <el-select v-model="seedanceMode" size="small" class="param-select">
            <el-option label="文生视频" value="text" />
            <el-option label="图生视频-首帧" value="image_first_frame" />
            <el-option label="图生视频-首尾帧" value="image_first_last" />
            <el-option label="多模态参考" value="multi_modal" />
          </el-select>
        </div>

        <!-- PixVerse 生成类型：文生 / 图生 / 首尾帧 / 多主体（不支持多模态参考） -->
        <div v-if="provider === 'pixverse'" class="param-item">
          <div class="param-label">PixVerse 类型</div>
          <el-select v-model="pixverseMode" size="small" class="param-select">
            <el-option label="文生视频" value="text_to_video" />
            <el-option label="图生视频" value="image_to_video_first_only" />
            <el-option label="首尾帧生视频" value="image_to_video_first_last" />
            <el-option label="多主体（多参考）" value="fusion_multi_subject" />
          </el-select>
        </div>

        <div v-if="provider === 'kling'" class="param-item">
          <div class="param-label">模式</div>
          <el-select v-model="mode" size="small" class="param-select">
            <el-option label="文生视频" value="text_to_video" />
            <el-option label="图生视频" value="image_to_video" />
          </el-select>
        </div>

        <!-- 图生视频子模式 -->
        <div v-if="mode === 'image_to_video' && provider === 'kling'" class="param-item">
          <div class="param-label">图生类型</div>
          <el-select v-model="imageSubType" size="small" class="param-select">
            <el-option label="仅首帧" value="first_only" />
            <el-option label="首尾帧（一镜到底）" value="first_last" />
            <el-option label="多图多镜头" value="multi_shot" />
          </el-select>
        </div>

        <!-- 首帧/尾帧：仅通过连线输入，不在节点内上传 -->
        <template
          v-if="(provider === 'kling' && mode === 'image_to_video' && (imageSubType === 'first_only' || imageSubType === 'first_last'))
              || (provider === 'seedance' && (seedanceMode === 'image_first_frame' || seedanceMode === 'image_first_last'))"
        >
          <div class="param-item image-input-row">
            <div class="param-label">首帧</div>
            <div class="image-slot">
              <img v-if="firstFramePreview" :src="firstFramePreview" class="thumb" alt="首帧" />
              <span v-else class="placeholder">请从图片节点连线传入首帧（第 1 张图）</span>
            </div>
          </div>
          <div
            v-if="(provider === 'kling' && imageSubType === 'first_last')
                || (provider === 'seedance' && seedanceMode === 'image_first_last')"
            class="param-item image-input-row"
          >
            <div class="param-label">尾帧</div>
            <div class="image-slot">
              <img v-if="endFramePreview" :src="endFramePreview" class="thumb" alt="尾帧" />
              <span v-else class="placeholder">请从图片节点连线传入尾帧（第 2 张图）</span>
            </div>
          </div>
        </template>

        <!-- PixVerse 图生视频/首尾帧：仅展示连线图片数量，不标注“首帧/尾帧” -->
        <template
          v-if="provider === 'pixverse' && (pixverseMode === 'image_to_video_first_only' || pixverseMode === 'image_to_video_first_last')"
        >
          <div class="param-item">
            <div class="param-label">图片</div>
            <span class="param-hint">{{ imageSourceCount }} 张（连线）</span>
            <span
              v-if="pixverseMode === 'image_to_video_first_only' && imageSourceCount > 1"
              class="param-hint warn"
            >仅首张用于图生（API 仅 img_id）</span>
          </div>
        </template>

        <template v-if="provider === 'pixverse' && pixverseMode === 'fusion_multi_subject'">
          <div class="param-item">
            <div class="param-label">图片</div>
            <span class="param-hint">{{ connectedImageUrls.length }} 张（连线）</span>
          </div>
        </template>

        <!-- 多图多镜头：展示已汇聚的图片数量 -->
        <div v-if="provider === 'kling' && mode === 'image_to_video' && imageSubType === 'multi_shot'" class="param-item">
          <div class="param-label">多图</div>
          <span class="param-hint">{{ connectedImageUrls.length }} 张（连线）</span>
        </div>

        <!-- Seedance 多模态：图片 + 来自参考节点的视频/音频 -->
        <template v-if="provider === 'seedance' && seedanceMode === 'multi_modal'">
          <div class="param-item">
            <div class="param-label">参考图</div>
            <span class="param-hint">{{ connectedImageUrls.length || (firstFramePreview ? 1 : 0) }} 张（连线）</span>
          </div>
          <div class="param-item">
            <div class="param-label">参考视频</div>
            <span class="param-hint">{{ connectedVideoRefUrls.length }} 个（通过视频参考节点连线）</span>
          </div>
          <div class="param-item">
            <div class="param-label">参考音频</div>
            <span class="param-hint">{{ connectedAudioRefUrls.length }} 个（通过音频参考节点连线）</span>
          </div>
        </template>

        <div class="param-item">
          <div class="param-label">时长(秒)</div>
          <!-- Seedance：支持自动(-1) 或 4-15 手动，避免数值跳动 -->
          <div style="display: flex; align-items: center; gap: 6px;">
            <el-switch
              v-if="provider !== 'pixverse'"
              v-model="durationAuto"
              inline-prompt
              active-text="自动"
              inactive-text="自定义"
              size="small"
            />
            <!-- PixVerse 多主体 fusion：v5.5/5.6 仅 5/8/10；1080p 不可用 10 -->
            <el-select
              v-if="provider === 'pixverse' && pixverseMode === 'fusion_multi_subject'"
              v-model="durationManual"
              size="small"
              class="param-select"
              style="width: 112px"
            >
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option v-if="resolution !== '1080p'" label="10" :value="10" />
            </el-select>
            <!-- 勿用 v-else：否则 Seedance/Kling 时 switch 占满 v-if 分支，输入框永远不渲染 -->
            <el-input-number
              v-if="
                provider !== 'pixverse' ||
                (provider === 'pixverse' && pixverseMode !== 'fusion_multi_subject')
              "
              v-model="durationManual"
              :max="15"
              :min="provider === 'pixverse' ? 1 : 4"
              :step="1"
              size="small"
              :disabled="provider !== 'pixverse' && durationAuto"
              :controls="false"
            />
          </div>
        </div>

        <div class="param-item">
          <div class="param-label">分辨率</div>
          <el-select v-model="resolution" size="small" class="param-select">
            <template v-if="provider === 'seedance'">
              <el-option label="480p" value="480p" />
              <el-option label="720p" value="720p" />
            </template>
            <template v-else-if="provider === 'pixverse'">
              <el-option label="540p" value="540p" />
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
            </template>
            <template v-else>
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
              <el-option label="4k" value="4k" />
            </template>
          </el-select>
        </div>

        <div class="param-item">
          <div class="param-label">比例</div>
          <el-select v-model="aspectRatio" size="small" class="param-select">
            <template v-if="provider === 'pixverse'">
              <el-option label="16:9" value="16:9" />
              <el-option label="9:16" value="9:16" />
              <el-option label="4:3" value="4:3" />
              <el-option label="3:4" value="3:4" />
              <el-option label="1:1" value="1:1" />
            </template>
            <template v-else>
              <el-option label="自适应 (adaptive)" value="adaptive" />
              <el-option label="16:9" value="16:9" />
              <el-option label="4:3" value="4:3" />
              <el-option label="1:1" value="1:1" />
              <el-option label="3:4" value="3:4" />
              <el-option label="9:16" value="9:16" />
              <el-option label="21:9" value="21:9" />
            </template>
          </el-select>
        </div>

        <el-button
          type="primary"
          size="default"
          class="execute-btn"
          :loading="loading"
          :disabled="!canExecute || loading || generationInFlight || generationCooldownLeftSec > 0 || hasActiveGeneration"
          @click="handleGenerate"
        >
          {{ executeButtonText }}
        </el-button>
      </div>
    </div>

    <!-- 全屏视频预览 -->
    <el-dialog
      v-model="showFullscreen"
      :show-close="true"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :append-to-body="true"
      :modal="true"
      :modal-append-to-body="true"
      modal-class="fullscreen-video-overlay"
      width="100%"
      top="0"
      class="fullscreen-video-dialog"
      @close="handleCloseFullscreen"
    >
      <div class="fullscreen-video-container" @click="handleCloseFullscreen">
        <video
          v-if="fullscreenUrl"
          :src="fullscreenUrl"
          controls
          autoplay
          class="fullscreen-video"
          @click.stop
        />
      </div>
    </el-dialog>

    <!-- 节点连接点：允许从提示词/图片连入，向右侧输出 -->
    <Handle
      id="target"
      type="target"
      :position="Position.Left"
      :style="{
        background: '#409eff',
        width: '12px',
        height: '12px',
        border: '2px solid #1a1a1a',
        borderRadius: '50%',
        cursor: 'crosshair',
        top: '50%'
      }"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Right"
      :style="{
        background: '#555',
        width: '12px',
        height: '12px',
        border: '2px solid white',
        borderRadius: '50%',
        cursor: 'crosshair'
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, inject, nextTick, type Ref } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { VideoCamera } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { createVideoTask, getVideoTask, type VideoMode, type ImageSubType } from '@/api/video';
import { getUploadUrl } from '@/utils/image-loader';
import { createSeedanceGeneration, getSeedanceGenerationStatus, createSeedanceAdvanced, type SeedanceAdvancedAction } from '@/api/seedance';
import {
  createPixverseGeneration,
  createPixverseImageGeneration,
  createPixverseFusionGeneration,
  createPixverseTransitionGeneration,
  getPixverseGenerationStatus,
} from '@/api/pixverse';
import { probeMediaUrl } from '@/api/media';
import { useUserStore } from '@/store/user';
import { notifyMediaGeneration } from '@/utils/browser-notification';
import { isImageNodeReady, summarizeConnectedImages, type ImageNodeLikeData } from '@/utils/media-ready';
import { allocPixverseRefName, parseImageFigureNumberFromAlias } from '@/utils/pixverse-ref-name';

defineEmits<{
  updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();
const { getEdges, findNode, addNodes, addEdges, getNodes, updateNodeInternals } = useVueFlow();
const userStore = useUserStore();

function notifyVideoGen(success: boolean, message: string) {
  void notifyMediaGeneration({
    kind: 'video',
    success,
    nodeId: String(props.id),
    message
  });
}

type CreditTrackerStore = {
  addSpent: (amount: number) => void;
  getTotalSpent: () => number;
};
const creditTracker = inject<CreditTrackerStore | null>('creditTracker', null);
const workflowTemplateId = inject<Ref<number | null> | null>('workflowTemplateId', null);

function withTemplateId<T extends object>(obj: T): T {
  const tid = workflowTemplateId?.value;
  if (tid != null && tid > 0) {
    (obj as { templateId?: number }).templateId = tid;
  }
  return obj;
}

type WorkflowPersistenceStore = {
  saveImmediately: () => void;
};

const workflowPersistence = inject<WorkflowPersistenceStore | null>('workflowPersistence', null);
const saveWorkflowImmediately = () => {
  if (workflowPersistence && typeof workflowPersistence.saveImmediately === 'function') {
    try {
      workflowPersistence.saveImmediately();
    } catch (e) {
      console.error('[VideoNode] 保存工作流失败:', e);
    }
  }
};

// 模型提供方：kling / seedance / pixverse（PixVerse 支持文生 + 图生首帧/首尾帧）
const provider = ref<'kling' | 'seedance' | 'pixverse'>('seedance');

// Seedance 内部模式：文生 / 图生首帧 / 首尾帧 / 多参考图
const seedanceMode = ref<SeedanceAdvancedAction>('text');

// PixVerse 生成类型：文生 / 图生(单图) / 首尾帧 / 多主体(多参考)
const pixverseMode = ref<
  'text_to_video' | 'image_to_video_first_only' | 'image_to_video_first_last' | 'fusion_multi_subject'
>('text_to_video');

// 输入：从上游节点采集的提示词 & 图片 / 视频 / 音频参考
const connectedPrompt = ref('');
const connectedImageUrl = ref<string | null>(null);
const connectedEndImageUrl = ref<string | null>(null);
const connectedImageUrls = ref<string[]>([]);
/** PixVerse 多主体 fusion：与 connectedImageUrls 同序，对应 image_references.ref_name */
const connectedImageRefNames = ref<string[]>([]);
/** 与 connectedImageUrls 同序：画布「图N」里的 N，用于 @图4 → 第 4 张图对应 ref */
const connectedImageFigureNumbers = ref<number[]>([]);
const imageSourceCount = ref(0);
const connectedImageReadiness = ref({
  total: 0,
  ready: 0,
  loading: 0,
  error: 0,
  missingUrl: 0,
});

const connectedVideoRefUrls = ref<string[]>([]);
const connectedAudioRefUrls = ref<string[]>([]);

type MediaRefMeta = {
  url: string;
  durationSeconds?: number;
};
const connectedVideoRefMeta = ref<MediaRefMeta[]>([]);
const connectedAudioRefMeta = ref<MediaRefMeta[]>([]);

const currentNode = computed(() => {
  return getNodes.value.find(n => n.id === props.id);
});

/** 当前这次任务要写入的 videoResult 节点 id；重新生成时会新建节点并切换到此 id，旧节点保留 */
const activeVideoResultNodeId = ref<string | null>(null);

const VIDEO_RESULT_EST_HEIGHT = 280;
const VIDEO_RESULT_STACK_GAP = 24;

function getNextVideoResultPosition(): { x: number; y: number } {
  const self = currentNode.value;
  if (!self) return { x: 0, y: 0 };
  const nodeWidth = self.dimensions?.width || 360;
  const baseX = self.position.x + nodeWidth + 100;
  const siblings = getNodes.value.filter(
    n => n.type === 'videoResult' && (n.data as any)?.fromNodeId === props.id
  );
  if (siblings.length === 0) {
    return { x: baseX, y: self.position.y };
  }
  let maxBottom = self.position.y;
  for (const n of siblings) {
    const h = n.dimensions?.height ?? VIDEO_RESULT_EST_HEIGHT;
    maxBottom = Math.max(maxBottom, n.position.y + h);
  }
  return { x: baseX, y: maxBottom + VIDEO_RESULT_STACK_GAP };
}

/** 已成功生成过视频后再次点击生成：新建结果节点，旧节点不覆盖 */
function forkNewVideoResultNodeIfNeeded() {
  const hasVideo =
    status.value === 'succeeded' &&
    videoUrls.value.length > 0 &&
    typeof videoUrls.value[0] === 'string' &&
    videoUrls.value[0].trim().length > 0;
  if (!hasVideo) return;

  const self = currentNode.value;
  if (!self) return;

  const pos = getNextVideoResultPosition();
  const nodeId = `video_result_${Date.now()}`;
  const edgeId = `edge_${props.id}_to_${nodeId}_${Date.now()}`;
  activeVideoResultNodeId.value = nodeId;

  addNodes({
    id: nodeId,
    type: 'videoResult',
    position: pos,
    data: {
      fromNodeId: props.id,
      videoUrl: '',
      status: 'pending',
      progress: null,
      errorMessage: null,
      taskMeta: {
        provider: provider.value,
        taskId: null as number | null,
        seedanceTaskKey: null as string | null,
      },
    },
  });
  updateNodeInternals([nodeId]);
  addEdges({
    id: edgeId,
    source: props.id,
    target: nodeId,
    sourceHandle: 'source',
    targetHandle: 'source',
    type: 'default',
    animated: true,
  });
  saveWorkflowImmediately();
}

// 创建或更新“视频结果节点”：从创建任务开始就存在，并在轮询过程中实时同步状态
const syncResultVideoNode = () => {
  const self = currentNode.value;
  if (!self) return;

  const url = videoUrls.value[0] || '';

  const taskMeta = {
    provider: provider.value,
    taskId: taskId.value,
    seedanceTaskKey: seedanceTaskKey.value,
  };

  // 同步任务快照到 VideoNode 节点自身数据，避免历史恢复时依赖 videoResult 节点
  // （例如首屏节点异步渲染/快照不完整导致找不到 videoResult）的情况。
  (self.data as any).__videoTask = {
    taskMeta,
    status: status.value,
    progress: progress.value,
    errorMessage: errorMessage.value,
    videoUrl: url,
    activeResultNodeId: activeVideoResultNodeId.value,
  };

  const patchResultData = (target: { id: string; data?: any; type?: string }) => {
    target.data = {
      ...(target.data || {}),
      fromNodeId: props.id,
      videoUrl: url,
      status: status.value,
      progress: progress.value,
      errorMessage: errorMessage.value,
      taskMeta,
    };
    updateNodeInternals([target.id]);
    saveWorkflowImmediately();
  };

  const byId = activeVideoResultNodeId.value
    ? getNodes.value.find(n => n.id === activeVideoResultNodeId.value)
    : undefined;
  if (byId && byId.type === 'videoResult') {
    patchResultData(byId);
    return;
  }

  // 兼容旧工作流：未记录 active 时，更新第一个派生结果节点
  const existing = getNodes.value.find(
    n => n.type === 'videoResult' && (n.data as any)?.fromNodeId === props.id
  );
  if (existing) {
    activeVideoResultNodeId.value = existing.id;
    patchResultData(existing);
    return;
  }

  // 否则创建新的结果节点（即使此时还没有 videoUrl）
  const nodeWidth = self.dimensions?.width || 360;
  const startX = self.position.x + nodeWidth + 100;
  const startY = self.position.y;

  const nodeId = `video_result_${Date.now()}`;
  const edgeId = `edge_${props.id}_to_${nodeId}_${Date.now()}`;
  activeVideoResultNodeId.value = nodeId;

  addNodes({
    id: nodeId,
    type: 'videoResult',
    position: {
      x: startX,
      y: startY,
    },
    data: {
      fromNodeId: props.id,
      videoUrl: url,
      status: status.value,
      progress: progress.value,
      errorMessage: errorMessage.value,
      taskMeta,
    },
  });

  updateNodeInternals([nodeId]);

  addEdges({
    id: edgeId,
    source: props.id,
    target: nodeId,
    sourceHandle: 'source',
    targetHandle: 'source',
    type: 'default',
    animated: true,
  });

  saveWorkflowImmediately();
};

// 表单状态（imageSubType 需在 watch 前声明）
const mode = ref<VideoMode>('text_to_video');
const imageSubType = ref<ImageSubType>('first_only');

/** 连入本节点的上游签名（用 getNodes.find 收集依赖，避免 findNode 与 data.text 追踪不稳定） */
const videoUpstreamSig = computed(() => {
  const nodes = getNodes.value;
  const parts: string[] = [];
  for (const e of getEdges.value) {
    if (e.target !== props.id) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n) {
      parts.push('');
      continue;
    }
    if (n.type === 'prompt') {
      parts.push(`p:${String((n.data as { text?: string })?.text ?? '')}`);
    } else if (n.type === 'image') {
      const d = n.data as Record<string, unknown>;
      parts.push(
        `i:${String(d?.imageUrl ?? '')}:${String(d?.isLoading)}:${String(d?.status ?? '')}:${String(d?.imageAlias ?? '')}:${JSON.stringify(d?.imageUrls ?? [])}`
      );
    } else if (n.type === 'videoRef') {
      const d = n.data as Record<string, unknown>;
      parts.push(`vr:${String(d?.url ?? '')}:${String(d?.durationSeconds)}`);
    } else if (n.type === 'videoResult') {
      const d = n.data as Record<string, unknown>;
      parts.push(`vres:${String(d?.videoUrl ?? '')}`);
    } else if (n.type === 'audioRef') {
      const d = n.data as Record<string, unknown>;
      parts.push(`ar:${String(d?.url ?? '')}:${String(d?.durationSeconds)}`);
    } else {
      parts.push(n.type);
    }
  }
  return parts.join('\u0001');
});

function readConnectedPromptFromEdges(): string {
  const nodes = getNodes.value;
  let prompt = '';
  for (const e of getEdges.value) {
    if (e.target !== props.id) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (n?.type !== 'prompt' || typeof n.data?.text !== 'string') continue;
    const t = n.data.text;
    if (t.length > 0 && !prompt) prompt = t;
  }
  return prompt;
}

// 监听连接变化，提取提示词、图片、视频参考、音频参考
watch(
  () => [getEdges.value, imageSubType.value, videoUpstreamSig.value, provider.value, pixverseMode.value, seedanceMode.value],
  () => {
    const edges = getEdges.value;
    const nodes = getNodes.value;
    const targetEdges = edges.filter(e => e.target === props.id);

    connectedPrompt.value = readConnectedPromptFromEdges();
    connectedImageUrl.value = null;
    connectedEndImageUrl.value = null;
    connectedImageUrls.value = [];
    connectedImageRefNames.value = [];
    connectedImageFigureNumbers.value = [];
    connectedVideoRefUrls.value = [];
    connectedAudioRefUrls.value = [];
    connectedVideoRefMeta.value = [];
    connectedAudioRefMeta.value = [];

    const imageSources: string[] = [];
    const isPixverseFusion = provider.value === 'pixverse' && pixverseMode.value === 'fusion_multi_subject';
    const fusionPairs: { url: string; ref: string; figureNum?: number }[] = [];
    const fusionRefUsed = new Set<string>();
    const imageSourceMeta: Array<ImageNodeLikeData> = [];
    const videoRefSources: string[] = [];
    const audioRefSources: string[] = [];
    const videoRefMetaSources: MediaRefMeta[] = [];
    const audioRefMetaSources: MediaRefMeta[] = [];
    for (const edge of targetEdges) {
      const sourceNode = nodes.find((x) => x.id === edge.source);
      if (!sourceNode) continue;

      if (sourceNode.type === 'image' && sourceNode.data?.imageUrl) {
        const url = sourceNode.data.imageUrl as string;
        if (typeof url === 'string' && url) {
          imageSources.push(url);
          if (isPixverseFusion) {
            const rawAlias = (sourceNode.data as { imageAlias?: string }).imageAlias;
            const ref = allocPixverseRefName(rawAlias, fusionPairs.length, fusionRefUsed);
            const figureNum = parseImageFigureNumberFromAlias(rawAlias) ?? undefined;
            fusionPairs.push({ url, ref, figureNum });
          }
        }
        imageSourceMeta.push({
          imageUrl: (sourceNode.data as any)?.imageUrl,
          isLoading: (sourceNode.data as any)?.isLoading,
          status: (sourceNode.data as any)?.status,
        });
      }
      if (sourceNode.data?.imageUrls && Array.isArray(sourceNode.data.imageUrls)) {
        const aliasBase = (sourceNode.data as { imageAlias?: string }).imageAlias;
        let idx = 0;
        for (const u of sourceNode.data.imageUrls) {
          if (typeof u === 'string' && u) {
            imageSources.push(u);
            if (isPixverseFusion) {
              const rawAlias =
                idx === 0
                  ? aliasBase
                  : aliasBase
                    ? `${aliasBase}_${idx + 1}`
                    : undefined;
              const ref = allocPixverseRefName(rawAlias, fusionPairs.length, fusionRefUsed);
              let figureNum = parseImageFigureNumberFromAlias(rawAlias);
              if (figureNum == null && idx > 0 && aliasBase) {
                const baseN = parseImageFigureNumberFromAlias(aliasBase);
                if (baseN != null) figureNum = baseN + idx;
              }
              fusionPairs.push({ url: u, ref, figureNum: figureNum ?? undefined });
            }
            idx += 1;
          }
        }
        // imageUrls 多用于结果聚合；这里只用 node 级别状态判断是否可用
        if (Array.isArray((sourceNode.data as any)?.imageUrls) && (sourceNode.data as any).imageUrls.length > 0) {
          imageSourceMeta.push({
            imageUrl: (sourceNode.data as any)?.imageUrls?.[0],
            isLoading: (sourceNode.data as any)?.isLoading,
            status: (sourceNode.data as any)?.status,
          });
        }
      }

      if (sourceNode.type === 'videoRef' && sourceNode.data?.url) {
        const v = sourceNode.data.url as string;
        if (typeof v === 'string' && v.trim()) {
          const u = getUploadUrl(v.trim());
          videoRefSources.push(u);
          const d = Number((sourceNode.data as any)?.durationSeconds);
          videoRefMetaSources.push({
            url: u,
            ...(Number.isFinite(d) && d > 0 ? { durationSeconds: d } : {}),
          });
        }
      }
      if (sourceNode.type === 'videoResult' && sourceNode.data?.videoUrl) {
        const v = sourceNode.data.videoUrl as string;
        if (typeof v === 'string' && v.trim()) {
          const u = getUploadUrl(v.trim());
          videoRefSources.push(u);
          // videoResult 节点一般拿不到时长 metadata
          videoRefMetaSources.push({ url: u });
        }
      }

      if (sourceNode.type === 'audioRef' && sourceNode.data?.url) {
        const v = sourceNode.data.url as string;
        if (typeof v === 'string' && v.trim()) {
          const u = getUploadUrl(v.trim());
          audioRefSources.push(u);
          const d = Number((sourceNode.data as any)?.durationSeconds);
          audioRefMetaSources.push({
            url: u,
            ...(Number.isFinite(d) && d > 0 ? { durationSeconds: d } : {}),
          });
        }
      }
    }

    imageSourceCount.value = imageSources.length;
    connectedImageReadiness.value = summarizeConnectedImages(imageSourceMeta);

    connectedVideoRefUrls.value = [...new Set(videoRefSources)];
    connectedAudioRefUrls.value = [...new Set(audioRefSources)];
    // meta 也按 url 去重（优先保留有 duration 的记录）
    const dedupeMeta = (items: MediaRefMeta[]) => {
      const map = new Map<string, MediaRefMeta>();
      for (const it of items) {
        const existing = map.get(it.url);
        if (!existing) {
          map.set(it.url, it);
          continue;
        }
        if (existing.durationSeconds == null && it.durationSeconds != null) {
          map.set(it.url, it);
        }
      }
      return Array.from(map.values());
    };
    connectedVideoRefMeta.value = dedupeMeta(videoRefMetaSources);
    connectedAudioRefMeta.value = dedupeMeta(audioRefMetaSources);

    // PixVerse：图生（单图）与多主体 fusion 都需要完整连线 URL 列表（最多 7 张）
    if (
      provider.value === 'pixverse' &&
      (pixverseMode.value === 'image_to_video_first_only' || pixverseMode.value === 'fusion_multi_subject')
    ) {
      if (pixverseMode.value === 'fusion_multi_subject') {
        const seenU = new Set<string>();
        const outUrls: string[] = [];
        const outRefs: string[] = [];
        const outFigures: number[] = [];
        for (const p of fusionPairs) {
          if (seenU.has(p.url)) continue;
          seenU.add(p.url);
          outUrls.push(p.url);
          outRefs.push(p.ref);
          const slot = outUrls.length;
          outFigures.push(
            typeof p.figureNum === 'number' && Number.isFinite(p.figureNum) && p.figureNum >= 1
              ? p.figureNum
              : slot
          );
        }
        connectedImageUrls.value = outUrls.slice(0, 7);
        connectedImageRefNames.value = outRefs.slice(0, 7);
        connectedImageFigureNumbers.value = outFigures.slice(0, 7);
      } else {
        connectedImageUrls.value = [...new Set(imageSources)].slice(0, 7);
        connectedImageRefNames.value = [];
        connectedImageFigureNumbers.value = [];
      }
      if (imageSources.length > 0) {
        connectedImageUrl.value = imageSources[0] ?? null;
      }
      if (imageSources.length > 1) {
        connectedEndImageUrl.value = imageSources[1] ?? null;
      }
    }
    // Kling 多图多镜头：把所有图片作为序列
    else if (provider.value === 'kling' && imageSubType.value === 'multi_shot') {
      connectedImageUrls.value = [...new Set(imageSources)];
      if (imageSources.length > 0) {
        connectedImageUrl.value = imageSources[0] ?? null;
      }
    } else if (provider.value === 'seedance' && seedanceMode.value === 'multi_modal') {
      // Seedance 多模态：所有连上的图片都作为 referenceImageUrls
      connectedImageUrls.value = [...new Set(imageSources)];
      if (imageSources.length > 0) {
        connectedImageUrl.value = imageSources[0] ?? null;
      }
      if (imageSources.length > 1) {
        connectedEndImageUrl.value = imageSources[1] ?? null;
      }
    } else {
      // 其他模式：首帧 / 尾帧逻辑
      if (imageSources.length > 0) {
        connectedImageUrl.value = imageSources[0] ?? null;
      }
      if (imageSources.length > 1) {
        connectedEndImageUrl.value = imageSources[1] ?? null;
      }
    }

    // Seedance 模式下，根据连线自动调整为多模态模式，并提示用户
    // 防御：避免在 PixVerse/Kling 时也触发 Seedance 的提示/自动切换
    if (provider.value === 'seedance') {
      const hasImages = imageSourceCount.value > 0;
      const hasExtraImagesForFirst =
        seedanceMode.value === 'image_first_frame' && imageSourceCount.value > 1;
      const hasExtraImagesForFirstLast =
        seedanceMode.value === 'image_first_last' && imageSourceCount.value > 2;
      const hasVideoRefs = connectedVideoRefUrls.value.length > 0;
      const hasAudioRefs = connectedAudioRefUrls.value.length > 0;

      // 文生视频模式 + 接入了任意图片 / 视频 / 音频 ⇒ 自动切到多模态
      if (
        seedanceMode.value === 'text' &&
        (hasImages || hasVideoRefs || hasAudioRefs)
      ) {
        seedanceMode.value = 'multi_modal';
        ElMessage.info('检测到已连接图片或视频/音频参考，已自动切换模式，请确认模式是否正确。');
      }

      // 首帧模式：如果图片数量 >1，或连入了视频/音频，也自动切到多模态
      if (
        seedanceMode.value === 'image_first_frame' &&
        (hasExtraImagesForFirst || hasVideoRefs || hasAudioRefs)
      ) {
        seedanceMode.value = 'multi_modal';
        ElMessage.info('首帧模式仅支持 1 张图片，检测到多张图片或视频/音频参考，已自动切换模式，请确认模式是否正确。');
      }

      // 首帧+尾帧模式：如果图片数量 >2，或连入了视频/音频，也自动切到多模态
      if (
        seedanceMode.value === 'image_first_last' &&
        (hasExtraImagesForFirstLast || hasVideoRefs || hasAudioRefs)
      ) {
        seedanceMode.value = 'multi_modal';
        ElMessage.info('首帧+尾帧模式仅支持 2 张图片，检测到更多图片或视频/音频参考，已自动切换模式，请确认模式是否正确。');
      }
    }
  },
  { immediate: true }
);

// 表单状态（其余）
// 时长：
// - Seedance：自动(-1) 或手动 4-15 秒
// - PixVerse：仅手动 1-15 秒（隐藏“自动/自定义”开关），默认 1 秒
const durationAuto = ref(false);
const durationManual = ref<number>(4);
const resolution = ref<'540p' | '720p' | '1080p' | '4k'>('720p');
const aspectRatio = ref<string>('adaptive');

const providerLabel = computed(() =>
  provider.value === 'pixverse' ? 'PixVerse' : provider.value === 'kling' ? 'Kling' : 'Seedance'
);

const normalizeImageUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  return getUploadUrl(url);
};

const normalizeMediaUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  const v = String(url).trim();
  if (!v) return '';
  return getUploadUrl(v);
};

// 首帧/尾帧预览用 URL（连线优先，否则用上传的）
const firstFramePreview = computed(() => {
  const u = connectedImageUrl.value;
  return u ? normalizeImageUrl(u) : '';
});
const endFramePreview = computed(() => {
  const u = connectedEndImageUrl.value;
  return u ? normalizeImageUrl(u) : '';
});

// 任务状态
const taskId = ref<number | null>(null);
// Seedance 任务 key（用于刷新/恢复后继续轮询）
const seedanceTaskKey = ref<string | null>(null);
const status = ref<'pending' | 'running' | 'succeeded' | 'failed' | 'canceled'>('pending');
const progress = ref<number | null>(null);
const errorMessage = ref<string | null>(null);
const videoUrls = ref<string[]>([]);

const CONTENT_LIMIT_HINT = '图片内容可能受限，请确认图片内容';

const normalizeErrorMessage = (raw: unknown): string | null => {
  if (!raw) return null;
  const text = String(raw);
  const lower = text.toLowerCase();

  const contentLimitPatterns = [
    'failed to process generated image',
    'failed to process image urls to base64',
    'unable to show the generated image',
  ];

  const isContentLimited = contentLimitPatterns.some((p) => lower.includes(p));

  if (isContentLimited) {
    ElMessage.warning(CONTENT_LIMIT_HINT);
    return CONTENT_LIMIT_HINT;
  }

  return text;
};

const loading = ref(false);
// 防止“短时间内连续点击”触发重复创建任务（从而命中后端 429 限流）。
// 使用互斥锁 + 429 冷却：当创建接口返回 429 并带 retryAfter 时，冷却期内保持禁用。
const generationInFlight = ref(false);
const generationCooldownUntil = ref<number>(0);
const generationCooldownLeftSec = ref<number>(0);
let generationCooldownTimer: ReturnType<typeof setInterval> | null = null;

const clearGenerationCooldownTimer = () => {
  if (generationCooldownTimer) {
    clearInterval(generationCooldownTimer);
    generationCooldownTimer = null;
  }
};

const setGenerationCooldownSeconds = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  if (s <= 0) return;
  generationCooldownUntil.value = Date.now() + s * 1000;
  generationCooldownLeftSec.value = s;
  clearGenerationCooldownTimer();
  generationCooldownTimer = setInterval(() => {
    const leftMs = generationCooldownUntil.value - Date.now();
    const leftSec = Math.max(0, Math.ceil(leftMs / 1000));
    generationCooldownLeftSec.value = leftSec;
    if (leftSec <= 0) {
      clearGenerationCooldownTimer();
    }
  }, 250);
};

// 是否已有“实际生成任务”在进行中：防止用户在未取到结果前反复点击导致并发创建/并发轮询，从而更容易触发 429。
const hasActiveGeneration = computed(() => {
  const isActive = status.value === 'pending' || status.value === 'running';
  if (!isActive) return false;
  // seedance：seedanceTaskKey 一旦生成就意味着上游任务已创建/至少已进入轮询
  if (provider.value === 'seedance') return !!seedanceTaskKey.value;
  // kling：taskId 一旦生成就意味着上游任务已创建/至少已进入轮询
  return typeof taskId.value === 'number' && !Number.isNaN(taskId.value);
});

const showFullscreen = ref(false);
const fullscreenUrl = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const clearPollTimer = () => {
  if (!pollTimer) return;
  // pollTimer 既可能来自 setInterval，也可能来自 setTimeout（浏览器环境下返回值是同类型 id）
  clearInterval(pollTimer as any);
  clearTimeout(pollTimer as any);
  pollTimer = null;
};

function getSeedanceCreditsPerSecond(): number {
  // 与后端默认保持一致：20 积分 / 秒；如前端配置了 VITE_SEEDANCE_CREDITS_PER_SECOND 则优先使用
  const raw = import.meta.env.VITE_SEEDANCE_CREDITS_PER_SECOND;
  const n = raw != null ? Number(raw) : 28;
  if (Number.isNaN(n) || n <= 0) return 28;
  return n;
}

function getSeedanceDefaultDurationSeconds(): number {
  // 与后端默认保持一致：5 秒；如前端配置了 VITE_SEEDANCE_DEFAULT_DURATION 则优先使用
  const raw = (import.meta as any)?.env?.VITE_SEEDANCE_DEFAULT_DURATION;
  const n = raw != null ? Number(raw) : 5;
  if (Number.isNaN(n) || n <= 0) return 5;
  return n;
}

function getPixverseDefaultDurationSeconds(): number {
  // 与后端兜底保持一致：5 秒；如前端配置了 VITE_PIXVERSE_DEFAULT_DURATION 则优先使用
  const raw = (import.meta as any)?.env?.VITE_PIXVERSE_DEFAULT_DURATION;
  const n = raw != null ? Number(raw) : 5;
  if (Number.isNaN(n) || n <= 0) return 5;
  return n;
}

function getPixverseCreditsPerSecond(): number {
  // PixVerse：V6 且 generate_audio_switch=true
  // 540p => 5/s, 720p => 7/s, 1080p => 14/s
  if (resolution.value === '540p') return 5;
  if (resolution.value === '720p') return 7;
  return 14;
}

function getPixverseEffectiveDurationSeconds(): number {
  const manualSeconds = Number(durationManual.value);
  const rawSeconds = manualSeconds;

  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return 0;
  if (pixverseMode.value === 'image_to_video_first_last') {
    // 转场接口 duration 通常限制为 5/8；这里做兜底映射，保证前后端一致计费。
    return rawSeconds <= 5 ? 5 : 8;
  }
  if (pixverseMode.value === 'fusion_multi_subject') {
    // fusion（v5.5/5.6）：仅 5/8/10；1080p 时不可用 10（文档）
    let d = rawSeconds <= 5 ? 5 : rawSeconds <= 8 ? 8 : 10;
    if (resolution.value === '1080p' && d === 10) d = 8;
    return d;
  }
  return rawSeconds;
}

const executeCost = computed(() => {
  if (provider.value === 'seedance') {
    const seconds = durationAuto.value ? getSeedanceDefaultDurationSeconds() : Number(durationManual.value);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.round(seconds) * getSeedanceCreditsPerSecond();
  }

  if (provider.value === 'pixverse') {
    const seconds = getPixverseEffectiveDurationSeconds();
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.round(seconds) * getPixverseCreditsPerSecond();
  }

  // kling 或其它默认不计费（或在后端计费体系尚未接入该计费口径）
  return 0;
});

const canAfford = computed(() => {
  return userStore.canAffordOperation(executeCost.value);
});

const statusText = computed(() => {
  switch (status.value) {
    case 'pending':
      return '排队中';
    case 'running':
      return '生成中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'canceled':
      return '已取消';
    default:
      return status.value;
  }
});

watch(
  () => videoUrls.value[0],
  (val) => {
    if (val) {
      syncResultVideoNode();
    }
  }
);

// 是否可以执行（输入是否就绪）
const inputReady = computed(() => {
  // Seedance：根据子类型判断
  if (provider.value === 'seedance') {
    if (seedanceMode.value === 'text') {
      return !!connectedPrompt.value;
    }
    if (seedanceMode.value === 'image_first_frame') {
      const first = !!connectedImageUrl.value;
      // 必须且只能 1 张图
      return !!connectedPrompt.value && first && imageSourceCount.value === 1;
    }
    if (seedanceMode.value === 'image_first_last') {
      const first = !!connectedImageUrl.value;
      const end = !!connectedEndImageUrl.value;
      // 必须且只能 2 张图
      return !!connectedPrompt.value && first && end && imageSourceCount.value === 2;
    }
    if (seedanceMode.value === 'multi_modal') {
      // 多模态：根据文档，文本必填，图片/视频/音频为可选组合
      return !!connectedPrompt.value;
    }
    return !!connectedPrompt.value;
  }

  // PixVerse：仅文生视频（禁止图片/视频/音频参考连线）
  if (provider.value === 'pixverse') {
    // PixVerse 平台限制：最多 7 张图片
    if (imageSourceCount.value > 7) return false;

    if (pixverseMode.value === 'text_to_video') {
      return (
        !!connectedPrompt.value &&
        imageSourceCount.value === 0 &&
        connectedVideoRefUrls.value.length === 0 &&
        connectedAudioRefUrls.value.length === 0
      );
    }

    // PixVerse 图生视频：单图 img_id（连线可多张，但仅首张有效），不支持视频/音频参考
    if (pixverseMode.value === 'image_to_video_first_only') {
      const first = !!connectedImageUrl.value;
      return (
        !!connectedPrompt.value &&
        first &&
        imageSourceCount.value >= 1 &&
        imageSourceCount.value <= 7 &&
        connectedVideoRefUrls.value.length === 0 &&
        connectedAudioRefUrls.value.length === 0
      );
    }

    // PixVerse 多主体（fusion）：>=2 张图片，不支持视频/音频参考
    if (pixverseMode.value === 'fusion_multi_subject') {
      return (
        !!connectedPrompt.value &&
        imageSourceCount.value >= 2 &&
        imageSourceCount.value <= 7 &&
        connectedVideoRefUrls.value.length === 0 &&
        connectedAudioRefUrls.value.length === 0
      );
    }

    if (pixverseMode.value === 'image_to_video_first_last') {
      const first = !!connectedImageUrl.value;
      const last = !!connectedEndImageUrl.value;
      return (
        !!connectedPrompt.value &&
        first &&
        last &&
        imageSourceCount.value === 2 &&
        connectedVideoRefUrls.value.length === 0 &&
        connectedAudioRefUrls.value.length === 0
      );
    }

    return false;
  }

  if (mode.value === 'text_to_video') {
    return !!connectedPrompt.value;
  }
  if (mode.value === 'image_to_video') {
    const first = !!connectedImageUrl.value;
    if (imageSubType.value === 'first_only') {
      // Kling 首帧：必须且只能 1 张图
      return !!connectedPrompt.value && first && imageSourceCount.value === 1;
    }
    if (imageSubType.value === 'first_last') {
      const end = !!connectedEndImageUrl.value;
      // Kling 首尾帧：必须且只能 2 张图
      return !!connectedPrompt.value && first && end && imageSourceCount.value === 2;
    }
    if (imageSubType.value === 'multi_shot') {
      return !!connectedPrompt.value && connectedImageUrls.value.length >= 2;
    }
  }
  return !!connectedPrompt.value || !!connectedImageUrl.value;
});

const executeButtonText = computed(() => {
  const base = status.value === 'succeeded' && videoUrls.value.length > 0 ? '重新生成视频' : '生成视频';
  if (userStore.userInfo?.role === 1) return base;
  const cost = executeCost.value;
  return cost > 0 ? `${base} (消耗 ${cost} 积分)` : base;
});

// 是否可以执行（包含积分校验）
const canExecute = computed(() => {
  // 只有当确实连入了图片（图生视频/多模态等）时，才强制要求图片已就绪
  const hasAnyImageInput = imageSourceCount.value > 0;
  const imagesReady =
    provider.value === 'pixverse'
      ? true
      : !hasAnyImageInput || connectedImageReadiness.value.total === 0
        ? true
        : connectedImageReadiness.value.ready === connectedImageReadiness.value.total;
  return inputReady.value && canAfford.value && imagesReady;
});

// 根据连接自动调整模式：有图片则优先图生视频（仅对 kling 生效）
watch(
  () => connectedImageUrl.value,
  (val) => {
    if (val && provider.value === 'kling') {
      mode.value = 'image_to_video';
    } else if (provider.value === 'kling' && mode.value === 'image_to_video') {
      mode.value = 'text_to_video';
    }
  },
  { immediate: true }
);

// PixVerse 自动调整生成类型：
// - 0 张图：文生
// - 1 张图：图生（单图 img_id）
// - >=2 张图：多主体（fusion，多参考）
// - 首尾帧模式必须用户手动选择，不自动切入/切出
watch(
  () => [provider.value, connectedImageUrl.value, connectedEndImageUrl.value, imageSourceCount.value],
  ([p, img, endImg, imgCount]) => {
    if (p !== 'pixverse') return;
    if (pixverseMode.value === 'image_to_video_first_last') return;

    const count = Number(imgCount || 0);
    if (!img || count <= 0) {
      pixverseMode.value = 'text_to_video';
      return;
    }
    if (count === 1) {
      pixverseMode.value = 'image_to_video_first_only';
      return;
    }
    pixverseMode.value = 'fusion_multi_subject';
  },
  { immediate: true }
);

// 切换 provider 时，把分辨率/比例/时长约束到各平台允许范围内，避免切换后状态非法导致创建失败。
watch(
  () => provider.value,
  (p) => {
    if (p === 'pixverse') {
      if (!['540p', '720p', '1080p'].includes(resolution.value)) resolution.value = '720p';
      if (!['16:9', '9:16', '4:3', '3:4', '1:1'].includes(aspectRatio.value)) aspectRatio.value = '16:9';
      durationAuto.value = false;
      // PixVerse：默认 1 秒，且仅支持手动 1-15（多主体 fusion 会在下方 watch 中改为 5/8/10）
      durationManual.value = 1;

      // 切换到 PixVerse 时，按连线自动识别模式（首尾帧不自动切）
      const c = Number(imageSourceCount.value || 0);
      pixverseMode.value = c >= 2 ? 'fusion_multi_subject' : connectedImageUrl.value ? 'image_to_video_first_only' : 'text_to_video';
      if (pixverseMode.value === 'fusion_multi_subject') {
        durationManual.value = 5;
      }
      return;
    }
    if (p === 'seedance') {
      if (!['480p', '720p'].includes(resolution.value)) resolution.value = '720p';
      durationManual.value = Math.min(15, Math.max(4, Number(durationManual.value) || 4));

      // 切换到 Seedance 时，根据连线自动识别模式（无 toast，避免切换时打扰）
      const imgCount = imageSourceCount.value;
      const hasVideoRefs = connectedVideoRefUrls.value.length > 0;
      const hasAudioRefs = connectedAudioRefUrls.value.length > 0;
      if (hasVideoRefs || hasAudioRefs || imgCount > 2) {
        seedanceMode.value = 'multi_modal';
      } else if (imgCount === 2) {
        seedanceMode.value = 'image_first_last';
      } else if (imgCount === 1) {
        seedanceMode.value = 'image_first_frame';
      } else {
        seedanceMode.value = 'text';
      }
      return;
    }

    if (p === 'kling') {
      if (!['720p', '1080p', '4k'].includes(resolution.value)) resolution.value = '720p';
      durationManual.value = Math.min(15, Math.max(4, Number(durationManual.value) || 4));

      // 切换到 Kling 时，根据连线自动识别模式
      if (imageSourceCount.value > 0) {
        mode.value = 'image_to_video';
        imageSubType.value = connectedEndImageUrl.value ? 'first_last' : 'first_only';
      } else {
        mode.value = 'text_to_video';
      }
      return;
    }
  },
  { immediate: true }
);

/** PixVerse 多主体：时长仅 5/8/10；1080p 不可选 10 */
watch(
  () =>
    [provider.value, pixverseMode.value, resolution.value, durationManual.value] as const,
  () => {
    if (provider.value !== 'pixverse' || pixverseMode.value !== 'fusion_multi_subject') return;
    const allowed: number[] = resolution.value === '1080p' ? [5, 8] : [5, 8, 10];
    const n = Number(durationManual.value);
    if (resolution.value === '1080p' && n === 10) {
      durationManual.value = 8;
      return;
    }
    if (!allowed.includes(n)) {
      durationManual.value = 5;
    }
  },
  { flush: 'sync' }
);

const startPollingKling = (id: number, opts?: { silent?: boolean }) => {
  if (pollTimer) clearInterval(pollTimer);
  const silent = !!opts?.silent;
  pollTimer = setInterval(async () => {
    try {
      const res = await getVideoTask(id) as any;
      const t = (res?.data ?? res) as any;
      status.value = (t.status as any) || 'pending';
      progress.value = t?.progress ?? null;
      errorMessage.value = normalizeErrorMessage(t?.error_message);

      if (Array.isArray(t?.video_urls) && t.video_urls.length > 0) {
        videoUrls.value = t.video_urls.map((u: string) => normalizeImageUrl(u));
      }

      // 上游可能出现“status 仍为进行中，但其实已经返回可播放视频链接”的情况；
      // 以结果链接是否存在为准，直接判定 succeeded 并停止轮询。
      if (
        videoUrls.value.length > 0 &&
        ['pending', 'running'].includes(status.value)
      ) {
        status.value = 'succeeded';
        errorMessage.value = null;
      }

      if (['succeeded', 'failed', 'canceled'].includes(status.value)) {
        syncResultVideoNode();
        saveWorkflowImmediately();

        if (!silent) {
          if (status.value === 'succeeded' && videoUrls.value.length > 0) {
            notifyVideoGen(true, 'Kling 视频任务已完成。');
          } else if (status.value === 'succeeded') {
            notifyVideoGen(
              false,
              errorMessage.value || '任务状态为成功但未返回视频链接'
            );
          } else if (status.value === 'canceled') {
            notifyVideoGen(false, errorMessage.value || '视频任务已取消');
          } else {
            notifyVideoGen(false, errorMessage.value || '视频生成失败');
          }
        }

        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    } catch (e: any) {
      console.error('[VideoNode] 轮询失败', e);
      errorMessage.value = normalizeErrorMessage(e?.message) || '查询视频任务状态失败';
      if (!silent) {
        notifyVideoGen(
          false,
          errorMessage.value
        );
      }
    }
  }, 5000);
};

const startPollingSeedance = (taskKey: string, opts?: { silent?: boolean }) => {
  clearPollTimer();
  const silent = !!opts?.silent;

  const SEEDANCE_POLL_BASE_INTERVAL_MS = 8000;
  const SEEDANCE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
  const seedanceStartTs = Date.now();

  let currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
  let pollingActive = true;

  const stopPolling = () => {
    pollingActive = false;
    clearPollTimer();
  };

  const scheduleNext = (delayMs: number) => {
    if (!pollingActive) return;
    clearPollTimer();
    pollTimer = setTimeout(() => void loop(), delayMs) as any;
  };

  const loop = async () => {
    if (!pollingActive) return;
    try {
      const r = await getSeedanceGenerationStatus(taskKey);
      const rawStatus = (r as any);
      const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
      if (!data) {
        currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
        scheduleNext(currentIntervalMs);
        return;
      }

      const nextStatus = (data.status as any) || 'pending';
      progress.value = (data as any).progress ?? null;
      errorMessage.value = normalizeErrorMessage((data as any).errorMessage);

      const nextVideoUrl = (data as any).videoUrl;
      const hasVideoUrl = typeof nextVideoUrl === 'string' && nextVideoUrl.trim().length > 0;
      // 以结果链接是否存在为准，避免状态卡在 running/pending
      status.value = hasVideoUrl ? 'succeeded' : nextStatus;

      if (hasVideoUrl) {
        videoUrls.value = [normalizeMediaUrl(nextVideoUrl)];
        errorMessage.value = null;
      } else if (nextStatus === 'succeeded') {
        // succeeded 但没有 videoUrl：继续等到后续轮询返回 videoUrl
        videoUrls.value = [];
      } else if (nextStatus === 'running' || nextStatus === 'pending' || nextStatus === 'queued') {
        // 进行中时如果后端回传了空 videoUrl，强制清掉旧链接，避免继续请求到过期/404 的 mp4
        videoUrls.value = [];
      }

      syncResultVideoNode();

      const shouldStopByTerminalState = nextStatus === 'failed' || nextStatus === 'canceled';
      const shouldStopBySuccess = hasVideoUrl;

      if (shouldStopBySuccess || shouldStopByTerminalState) {
        saveWorkflowImmediately();

        if (!silent) {
          if (shouldStopBySuccess) {
            notifyVideoGen(true, 'Seedance 视频任务已完成。');
          } else {
            const msg =
              nextStatus === 'canceled'
                ? errorMessage.value || '视频任务已取消'
                : errorMessage.value || '视频生成失败';
            notifyVideoGen(false, msg);
          }
        }

        stopPolling();
        return;
      }

      // 防御：最多等待 60 分钟仍未拿到 videoUrl，则强制失败，避免节点卡住
      const elapsedMs = Date.now() - seedanceStartTs;
      if (!hasVideoUrl && elapsedMs >= SEEDANCE_POLL_MAX_WAIT_MS) {
        status.value = 'failed';
        errorMessage.value = '任务已完成但未返回视频链接，已超时放弃回显';
        videoUrls.value = [];
        syncResultVideoNode();
        saveWorkflowImmediately();

        if (!silent) notifyVideoGen(false, errorMessage.value);
        stopPolling();
        return;
      }

      currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
      scheduleNext(currentIntervalMs);
    } catch (err: any) {
      const statusCode: number | undefined = err?.response?.status ?? err?.status;
      const retryAfterSeconds: number | undefined =
        typeof err?.response?.data?.retryAfter === 'number' ? err.response.data.retryAfter : undefined;

      console.error('[VideoNode] Seedance 轮询失败（恢复/后台轮询）', {
        taskKey,
        statusCode,
        retryAfterSeconds,
        responseData: err?.response?.data,
        message: err?.message,
      });

      if (statusCode === 429) {
        // 429：退避，避免一直撞限流导致错过成功回显
        const waitMsFromServer =
          typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : null;
        currentIntervalMs =
          waitMsFromServer != null
            ? Math.max(waitMsFromServer, SEEDANCE_POLL_BASE_INTERVAL_MS)
            : Math.min(Math.round(currentIntervalMs * 1.8), 120000);
        scheduleNext(currentIntervalMs);
        return;
      }

      // 其它错误：仍继续轮询，但把间隔拉长一点，避免抖动
      currentIntervalMs = Math.min(Math.round(currentIntervalMs * 1.5), 60000);
      errorMessage.value = normalizeErrorMessage(err?.message) || '查询 Seedance 任务状态失败';
      if (!silent) {
        notifyVideoGen(false, errorMessage.value);
      }
      scheduleNext(currentIntervalMs);
    }
  };

  scheduleNext(SEEDANCE_POLL_BASE_INTERVAL_MS);
};

const startPollingPixverse = (videoId: number, opts?: { silent?: boolean }) => {
  clearPollTimer();
  const silent = !!opts?.silent;

  const PIXVERSE_POLL_BASE_INTERVAL_MS = 5000;
  const PIXVERSE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
  const pixverseStartTs = Date.now();

  let currentIntervalMs = PIXVERSE_POLL_BASE_INTERVAL_MS;
  let pollingActive = true;

  const stopPolling = () => {
    pollingActive = false;
    clearPollTimer();
  };

  const scheduleNext = (delayMs: number) => {
    if (!pollingActive) return;
    clearPollTimer();
    pollTimer = setTimeout(() => void loop(), delayMs) as any;
  };

  const loop = async () => {
    if (!pollingActive) return;
    try {
      const r = await getPixverseGenerationStatus(videoId);
      const rawStatus = (r as any);
      const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
      if (!data) {
        currentIntervalMs = PIXVERSE_POLL_BASE_INTERVAL_MS;
        scheduleNext(currentIntervalMs);
        return;
      }

      const nextStatus = (data.status as any) || 'pending';
      progress.value = (data as any).progress ?? null;
      // 仅失败/取消展示 errorMessage；running 时上游可能带 ErrMsg=Success 等非错误字段
      if (nextStatus === 'failed' || nextStatus === 'canceled') {
        errorMessage.value = normalizeErrorMessage((data as any).errorMessage);
      } else {
        errorMessage.value = null;
      }

      const nextVideoUrl = (data as any).videoUrl;
      const hasVideoUrl = typeof nextVideoUrl === 'string' && nextVideoUrl.trim().length > 0;

      // 防御：PixVerse 可能出现 status=succeeded 但 url 还未就绪，此时保持 running，避免 0s 空视频
      status.value = hasVideoUrl ? 'succeeded' : nextStatus === 'succeeded' ? 'running' : nextStatus;

      if (hasVideoUrl) {
        videoUrls.value = [normalizeMediaUrl(nextVideoUrl)];
        errorMessage.value = null;
      } else if (nextStatus === 'succeeded') {
        videoUrls.value = [];
      }

      syncResultVideoNode();

      // PixVerse 可能出现 status=7 等与「失败」映射但仍返回 url；有 url 时只走成功终态
      const shouldStopByTerminalState = nextStatus === 'failed' && !hasVideoUrl;
      const shouldStopBySuccess = hasVideoUrl;

      if (shouldStopBySuccess || shouldStopByTerminalState) {
        saveWorkflowImmediately();

        if (!silent) {
          if (shouldStopBySuccess) {
            notifyVideoGen(true, 'PixVerse 视频任务已完成。');
          } else {
            notifyVideoGen(false, errorMessage.value || '视频生成失败');
          }
        }

        stopPolling();
        return;
      }

      // 防御：最多等待 60 分钟仍未拿到 videoUrl，则强制失败，避免节点卡住
      const elapsedMs = Date.now() - pixverseStartTs;
      if (!hasVideoUrl && elapsedMs >= PIXVERSE_POLL_MAX_WAIT_MS) {
        status.value = 'failed';
        errorMessage.value = '任务已完成但未返回视频链接，已超时放弃回显';
        videoUrls.value = [];
        syncResultVideoNode();
        saveWorkflowImmediately();

        if (!silent) notifyVideoGen(false, errorMessage.value);
        stopPolling();
        return;
      }

      currentIntervalMs = PIXVERSE_POLL_BASE_INTERVAL_MS;
      scheduleNext(currentIntervalMs);
    } catch (err: any) {
      const statusCode: number | undefined = err?.response?.status ?? err?.status;
      const retryAfterSeconds: number | undefined =
        typeof err?.response?.data?.retryAfter === 'number' ? err.response.data.retryAfter : undefined;

      if (statusCode === 429) {
        const waitMsFromServer =
          typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : null;
        currentIntervalMs =
          waitMsFromServer != null
            ? Math.max(waitMsFromServer, PIXVERSE_POLL_BASE_INTERVAL_MS)
            : Math.min(Math.round(currentIntervalMs * 1.8), 120000);
        scheduleNext(currentIntervalMs);
        return;
      }

      currentIntervalMs = Math.min(Math.round(currentIntervalMs * 1.5), 60000);
      errorMessage.value = normalizeErrorMessage(err?.message) || '查询 PixVerse 任务状态失败';
      if (!silent) {
        notifyVideoGen(false, errorMessage.value);
      }
      scheduleNext(currentIntervalMs);
    }
  };

  scheduleNext(PIXVERSE_POLL_BASE_INTERVAL_MS);
};

const handleGenerate = async () => {
  // 互斥：避免同一节点在 UI 尚未刷新时被重复点击触发多次创建
  if (generationInFlight.value) return;
  // 冷却：若上一次创建命中 429（带 retryAfter），冷却期内不允许再次创建
  if (generationCooldownLeftSec.value > 0 || Date.now() < generationCooldownUntil.value) return;

  // 没有结果之前禁止再次点击（尤其是轮询 toast 导致误以为失败时）
  if (hasActiveGeneration.value) {
    ElMessage.warning('视频任务正在生成中，请稍后等待');
    return;
  }

  if (!inputReady.value) {
    ElMessage.warning('请补全提示词与图片输入');
    return;
  }
  if (!canAfford.value) {
    ElMessage.warning('积分不足，请向超级管理员申请');
    return;
  }
  // 兜底：按钮状态可能因异步刷新滞后，这里再次阻断“上游图片未就绪”
  if (imageSourceCount.value > 0) {
    const s = connectedImageReadiness.value;
    const notReady = Math.max(0, (s.total || 0) - (s.ready || 0));
    if (notReady > 0) {
      if ((s.loading || 0) > 0) {
        ElMessage.warning('参考图片仍在上传/生成中，请等待完成后再生成');
      } else if ((s.error || 0) > 0) {
        ElMessage.warning('上游参考图片生成失败，请更换或重新生成后再试');
      } else {
        ElMessage.warning('参考图片尚未就绪，请稍后再试');
      }
      return;
    }
  }

  generationInFlight.value = true;
  loading.value = true;
  errorMessage.value = null;

  // 富文本提示词就地更新 data.text 时，兜底再读一次连线（与 dreamUpstreamSig / watch 一致）
  connectedPrompt.value = readConnectedPromptFromEdges();

  // 重新生成：若已有成功视频，新建结果节点（保留旧节点上的历史视频）
  forkNewVideoResultNodeIfNeeded();

  // 开始一次新生成前，先清空旧任务 key（避免历史/并发导致的错误恢复）
  taskId.value = null;
  seedanceTaskKey.value = null;

  const markPendingBeforeRequest = () => {
    // 只有在即将真正发出请求时，才把 UI 切到“排队中”，避免校验失败但 UI 误显示排队。
    status.value = 'pending';
    progress.value = null;
    videoUrls.value = [];
    syncResultVideoNode();
  };

  try {
    if (provider.value === 'seedance') {
      const basePrompt = connectedPrompt.value || '微距镜头对准树上鲜艳的花瓣，逐渐放大。';

      // 纯文生视频仍走简单接口
      if (seedanceMode.value === 'text') {
        markPendingBeforeRequest();
        const payload = withTemplateId({
          prompt: basePrompt,
          ratio: aspectRatio.value,
          duration: durationAuto.value ? -1 : durationManual.value,
          resolution: resolution.value,
          generateAudio: true,
          enableWebSearch: false,
        });
        const res = await createSeedanceGeneration(payload);
        // Seedance 在创建任务成功时即完成扣费，这里用于累计展示“本次消耗”
        creditTracker?.addSpent?.(executeCost.value);
        const raw = (res as any);
        const d = raw?.data?.data ?? raw?.data ?? raw;
        taskId.value = null;
        status.value = 'pending';
        progress.value = (d as any)?.progress ?? null;
        videoUrls.value = [];
        syncResultVideoNode();
        const taskKeySimple = d.task_id || d.id;
        if (!taskKeySimple) {
          ElMessage.error('Seedance 返回结果缺少任务 ID');
          notifyVideoGen(false, 'Seedance 返回结果缺少任务 ID');
          return;
        }
        seedanceTaskKey.value = String(taskKeySimple);
        syncResultVideoNode(); // 把 seedanceTaskKey 持久化到 videoResult，便于刷新后继续恢复
        clearPollTimer();
        const SEEDANCE_POLL_BASE_INTERVAL_MS = 8000;
        const SEEDANCE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
        const seedanceStartTs = Date.now();
        let currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
        let pollingActive = true;

        const stopPolling = () => {
          pollingActive = false;
          clearPollTimer();
        };

        const scheduleNext = (delayMs: number) => {
          if (!pollingActive) return;
          clearPollTimer();
          pollTimer = setTimeout(() => void loop(), delayMs) as any;
        };

        const loop = async () => {
          if (!pollingActive) return;
          try {
            const r = await getSeedanceGenerationStatus(taskKeySimple);
            const rawStatus = (r as any);
            const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
            if (!data) {
              currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
              scheduleNext(currentIntervalMs);
              return;
            }

            const nextStatus = (data.status as any) || 'pending';
            progress.value = (data as any).progress ?? null;
            errorMessage.value = normalizeErrorMessage((data as any).errorMessage);

            const nextVideoUrl = (data as any).videoUrl;
            const hasVideoUrl = typeof nextVideoUrl === 'string' && nextVideoUrl.trim().length > 0;
            status.value = nextStatus;

            if (hasVideoUrl) {
              videoUrls.value = [normalizeMediaUrl(nextVideoUrl)];
              // 拿到视频链接后清理错误，避免 URL/旧错误残留影响展示
              errorMessage.value = null;
            } else if (nextStatus === 'succeeded') {
              // succeeded 但没有 videoUrl：继续等到超时（或后续轮询返回 videoUrl）
              videoUrls.value = [];
            }

            syncResultVideoNode();

            const shouldStopByTerminalState = nextStatus === 'failed' || nextStatus === 'canceled';
            const shouldStopBySuccess = nextStatus === 'succeeded' && hasVideoUrl;

            // succeeds：必须 videoUrl 回来才算真正回显成功
            if (shouldStopBySuccess || shouldStopByTerminalState) {
              saveWorkflowImmediately();

              if (shouldStopBySuccess && status.value === 'succeeded' && videoUrls.value.length > 0) {
                notifyVideoGen(true, 'Seedance 视频任务已完成。');
              } else if (shouldStopByTerminalState) {
                const msg =
                  nextStatus === 'canceled'
                    ? errorMessage.value || '视频任务已取消'
                    : errorMessage.value || '视频生成失败';
                notifyVideoGen(false, msg);
              }

              stopPolling();
              return;
            }

            // 防御：最多等待 60 分钟仍未拿到 videoUrl，则强制失败，避免节点卡住
            const elapsedMs = Date.now() - seedanceStartTs;
            if (!hasVideoUrl && elapsedMs >= SEEDANCE_POLL_MAX_WAIT_MS) {
              status.value = 'failed';
              errorMessage.value = '任务已完成但未返回视频链接，已超时放弃回显';
              videoUrls.value = [];
              syncResultVideoNode();
              saveWorkflowImmediately();
              notifyVideoGen(false, errorMessage.value);
              stopPolling();
              return;
            }

            currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
            scheduleNext(currentIntervalMs);
          } catch (err: any) {
            const statusCode: number | undefined = err?.response?.status ?? err?.status;
            const retryAfterSeconds: number | undefined =
              typeof err?.response?.data?.retryAfter === 'number' ? err.response.data.retryAfter : undefined;

            // 打出更完整的信息，便于定位“到底是谁限流”（后端 or 上游）
            console.error('[VideoNode] Seedance 轮询失败', {
              taskId: taskKeySimple,
              statusCode,
              retryAfterSeconds,
              responseData: err?.response?.data,
              message: err?.message,
            });

            if (statusCode === 429) {
              // 429：退避，避免一直撞限流导致错过成功回显
              const waitMsFromServer =
                typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
                  ? retryAfterSeconds * 1000
                  : null;
              currentIntervalMs =
                waitMsFromServer != null
                  ? Math.max(waitMsFromServer, SEEDANCE_POLL_BASE_INTERVAL_MS)
                  : Math.min(Math.round(currentIntervalMs * 1.8), 120000);

              // 429 时不重复 notify，避免刷屏；请求会在退避后继续
              scheduleNext(currentIntervalMs);
              return;
            }

            // 其它错误：仍继续轮询，但把间隔拉长一点，避免抖动
            currentIntervalMs = Math.min(Math.round(currentIntervalMs * 1.5), 60000);
            notifyVideoGen(
              false,
              normalizeErrorMessage(err?.message) || '查询 Seedance 任务状态失败'
            );
            scheduleNext(currentIntervalMs);
          }
        };

        // 先立即拉一次（或你也可以改成 base interval 再拉）
        scheduleNext(SEEDANCE_POLL_BASE_INTERVAL_MS);
        ElMessage.success('Seedance 任务已创建，开始生成…');
        return;
      }

      // 高级模式：图生首帧 / 首尾帧 / 多参考图
      const action: SeedanceAdvancedAction = seedanceMode.value;
      const firstUrlRaw = connectedImageUrl.value;
      const endUrlRaw = connectedEndImageUrl.value;

      const payloadAdv: any = {
        prompt: basePrompt,
        action,
        ratio: aspectRatio.value,
        duration: durationAuto.value ? -1 : durationManual.value,
        resolution: resolution.value,
        generateAudio: true,
        enableWebSearch: false,
      };

      if (action === 'image_first_frame') {
        if (!firstUrlRaw) {
          ElMessage.warning('请提供首帧图片（连线或上传）');
          loading.value = false;
          return;
        }
        payloadAdv.firstImageUrl = normalizeImageUrl(firstUrlRaw);
      } else if (action === 'image_first_last') {
        if (!firstUrlRaw || !endUrlRaw) {
          ElMessage.warning('请提供首帧与尾帧图片（连线或上传）');
          loading.value = false;
          return;
        }
        payloadAdv.firstImageUrl = normalizeImageUrl(firstUrlRaw);
        payloadAdv.lastImageUrl = normalizeImageUrl(endUrlRaw);
      } else if (action === 'multi_modal') {
        // 文档允许的组合包含：文本(可选)+视频、文本(可选)+视频+音频 等，因此不强制要求图片。
        // 但音频不可单独存在，必须至少包含 1 个参考图片或视频。
        const imageRefsRaw = connectedImageUrls.value.length
          ? connectedImageUrls.value
          : (firstUrlRaw ? [firstUrlRaw] : []);
        const imageRefs = imageRefsRaw
          .map((u) => normalizeImageUrl(u))
          .filter(Boolean);

        const videoRefs = Array.from(new Set(connectedVideoRefUrls.value))
          .map((u) => normalizeMediaUrl(u))
          .filter(Boolean);

        const audioRefs = Array.from(new Set(connectedAudioRefUrls.value))
          .map((u) => normalizeMediaUrl(u))
          .filter(Boolean);

        if (audioRefs.length > 0 && imageRefs.length === 0 && videoRefs.length === 0) {
          ElMessage.warning('音频参考不能单独使用，请同时连入参考图片或参考视频');
          loading.value = false;
          return;
        }

        // 文档约束：参考视频/音频必须满足单条时长 [2,15] 秒；总时长不超过 15 秒
        // 此处强制对“缺少 duration metadata 的外链”进行后端探测，不允许绕过。
        const pickMeta = (wantedUrls: string[], metas: MediaRefMeta[]) => {
          const m = new Map<string, MediaRefMeta>();
          for (const it of metas) m.set(normalizeMediaUrl(it.url), it);
          return wantedUrls.map((u) => m.get(normalizeMediaUrl(u)) || { url: u });
        };
        const videoMetaPicked = pickMeta(videoRefs, connectedVideoRefMeta.value);
        const audioMetaPicked = pickMeta(audioRefs, connectedAudioRefMeta.value);

        const probeMissing = async (kind: 'video' | 'audio', items: MediaRefMeta[]): Promise<MediaRefMeta[]> => {
          const maxBytes = kind === 'video' ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
          const label = kind === 'video' ? '视频' : '音频';
          const out: MediaRefMeta[] = [];
          for (const it of items) {
            if (Number.isFinite(it.durationSeconds)) {
              out.push(it);
              continue;
            }
            // asset:// 或 data: 无法探测时长，按“必须校验”策略直接阻断
            if (it.url.startsWith('asset://') || it.url.startsWith('data:')) {
              ElMessage.error(`${label}参考使用素材ID/Base64 时，当前无法自动探测时长，请改用可访问的公网 URL`);
              throw new Error('MEDIA_PROBE_UNSUPPORTED');
            }
            const r: any = await probeMediaUrl({ url: it.url, kind });
            const d = r?.data?.data ?? r?.data ?? r;
            const durationSeconds = Number(d?.durationSeconds);
            const sizeBytes = Number(d?.sizeBytes);
            const mimeType = typeof d?.mimeType === 'string' ? d.mimeType.toLowerCase() : '';
            const container = typeof d?.container === 'string' ? d.container.toLowerCase() : '';
            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
              ElMessage.error(`无法解析${label}参考时长`);
              throw new Error('MEDIA_PROBE_FAILED');
            }
            if (Number.isFinite(sizeBytes) && sizeBytes > maxBytes) {
              ElMessage.error(`${label}参考文件大小超限（Seedance 文档限制）`);
              throw new Error('MEDIA_TOO_LARGE');
            }
            // 格式校验：视频 mp4/mov；音频 mp3/wav
            if (kind === 'video') {
              const ok = mimeType.includes('video/mp4') || mimeType.includes('video/quicktime') || container === 'mpeg-4' || container === 'mp4' || container === 'quicktime' || container === 'mov';
              if (!ok) {
                ElMessage.error('参考视频仅支持 mp4、mov 格式（Seedance 文档限制）');
                throw new Error('MEDIA_FORMAT_NOT_ALLOWED');
              }
            } else {
              const ok = mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3') || mimeType.includes('audio/wav') || mimeType.includes('audio/x-wav') || container === 'wav' || container === 'mpeg' || container === 'mp3';
              if (!ok) {
                ElMessage.error('参考音频仅支持 mp3、wav 格式（Seedance 文档限制）');
                throw new Error('MEDIA_FORMAT_NOT_ALLOWED');
              }
            }
            out.push({ url: it.url, durationSeconds });
          }
          return out;
        };

        let videoMetaFinal: MediaRefMeta[] = [];
        let audioMetaFinal: MediaRefMeta[] = [];
        try {
          videoMetaFinal = await probeMissing('video', videoMetaPicked);
          audioMetaFinal = await probeMissing('audio', audioMetaPicked);
        } catch {
          loading.value = false;
          return;
        }

        const validateDurations = (kindLabel: string, items: MediaRefMeta[]) => {
          const known = items.filter((x) => Number.isFinite(x.durationSeconds));
          for (const it of known) {
            const d = Number(it.durationSeconds);
            if (d < 2 || d > 15) {
              ElMessage.error(`${kindLabel}参考时长需在 2-15 秒范围内（Seedance 文档限制）`);
              return false;
            }
          }
          const total = known.reduce((sum, it) => sum + Number(it.durationSeconds), 0);
          if (total > 15 + 1e-6) {
            ElMessage.error(`${kindLabel}参考总时长不能超过 15 秒（Seedance 文档限制）`);
            return false;
          }
          return true;
        };

        if (!validateDurations('视频', videoMetaFinal) || !validateDurations('音频', audioMetaFinal)) {
          loading.value = false;
          return;
        }

        // 前端也按文档限制进行截断：总媒体(图片+视频+音频)最多 9；视频最多 3；音频最多 3；图片最多 9
        const TOTAL_LIMIT = 9;
        let remaining = TOTAL_LIMIT;

        const finalImages = imageRefs.slice(0, Math.min(9, remaining));
        remaining -= finalImages.length;

        const finalVideos = videoRefs.slice(0, Math.min(3, remaining));
        remaining -= finalVideos.length;

        const finalAudios = audioRefs.slice(0, Math.min(3, remaining));
        remaining -= finalAudios.length;

        if (finalImages.length) payloadAdv.referenceImageUrls = finalImages;
        if (finalVideos.length) payloadAdv.referenceVideoUrls = finalVideos;
        if (finalAudios.length) payloadAdv.referenceAudioUrls = finalAudios;
      }

      const res = await createSeedanceAdvanced(withTemplateId(payloadAdv));
      // Seedance 在创建任务成功时即完成扣费，这里用于累计展示“本次消耗”
      creditTracker?.addSpent?.(executeCost.value);
      const raw = (res as any);
      const d = raw?.data?.data ?? raw?.data ?? raw;
      taskId.value = null;
      status.value = 'pending';
      progress.value = (d as any)?.progress ?? null;
      videoUrls.value = [];
      syncResultVideoNode();
      // 轮询 Seedance 任务
      const taskKey = d.task_id || d.id;
      if (!taskKey) {
        ElMessage.error('Seedance 返回结果缺少任务 ID');
        notifyVideoGen(false, 'Seedance 返回结果缺少任务 ID');
        return;
      }
      seedanceTaskKey.value = String(taskKey);
      syncResultVideoNode(); // 把 seedanceTaskKey 持久化到 videoResult，便于刷新后继续恢复
      clearPollTimer();
      const SEEDANCE_POLL_BASE_INTERVAL_MS = 8000;
      const SEEDANCE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
      const seedanceStartTs = Date.now();
      let currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
      let pollingActive = true;

      const stopPolling = () => {
        pollingActive = false;
        clearPollTimer();
      };

      const scheduleNext = (delayMs: number) => {
        if (!pollingActive) return;
        clearPollTimer();
        pollTimer = setTimeout(() => void loop(), delayMs) as any;
      };

      const loop = async () => {
        if (!pollingActive) return;
        try {
          const r = await getSeedanceGenerationStatus(taskKey);
          const rawStatus = (r as any);
          const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
          if (!data) {
            currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
            scheduleNext(currentIntervalMs);
            return;
          }

          const nextStatus = (data.status as any) || 'pending';
          progress.value = (data as any).progress ?? null;
          errorMessage.value = normalizeErrorMessage((data as any).errorMessage);

          const nextVideoUrl = (data as any).videoUrl;
          const hasVideoUrl = typeof nextVideoUrl === 'string' && nextVideoUrl.trim().length > 0;
          status.value = nextStatus;

          if (hasVideoUrl) {
            videoUrls.value = [normalizeMediaUrl(nextVideoUrl)];
            errorMessage.value = null;
          } else if (nextStatus === 'succeeded') {
            // succeeded 但没有 videoUrl：继续等到超时（或后续轮询返回 videoUrl）
            videoUrls.value = [];
          }

          syncResultVideoNode();

          const shouldStopByTerminalState = nextStatus === 'failed' || nextStatus === 'canceled';
          const shouldStopBySuccess = nextStatus === 'succeeded' && hasVideoUrl;

          if (shouldStopBySuccess || shouldStopByTerminalState) {
            saveWorkflowImmediately();

            if (shouldStopBySuccess && status.value === 'succeeded' && videoUrls.value.length > 0) {
              notifyVideoGen(true, 'Seedance 视频任务已完成。');
            } else if (shouldStopByTerminalState) {
              const msg =
                nextStatus === 'canceled'
                  ? errorMessage.value || '视频任务已取消'
                  : errorMessage.value || '视频生成失败';
              notifyVideoGen(false, msg);
            }

            stopPolling();
            return;
          }

          // 防御：最多等待 60 分钟仍未拿到 videoUrl，则强制失败，避免节点卡住
          const elapsedMs = Date.now() - seedanceStartTs;
          if (!hasVideoUrl && elapsedMs >= SEEDANCE_POLL_MAX_WAIT_MS) {
            status.value = 'failed';
            errorMessage.value = '任务已完成但未返回视频链接，已超时放弃回显';
            videoUrls.value = [];
            syncResultVideoNode();
            saveWorkflowImmediately();
            notifyVideoGen(false, errorMessage.value);
            stopPolling();
            return;
          }

          currentIntervalMs = SEEDANCE_POLL_BASE_INTERVAL_MS;
          scheduleNext(currentIntervalMs);
        } catch (err: any) {
          const statusCode: number | undefined = err?.response?.status ?? err?.status;
          const retryAfterSeconds: number | undefined =
            typeof err?.response?.data?.retryAfter === 'number' ? err.response.data.retryAfter : undefined;

          console.error('[VideoNode] Seedance 轮询失败', {
            taskId: taskKey,
            statusCode,
            retryAfterSeconds,
            responseData: err?.response?.data,
            message: err?.message,
          });

          if (statusCode === 429) {
            // 429：退避，避免一直撞限流导致错过成功回显
            const waitMsFromServer =
              typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : null;
            currentIntervalMs =
              waitMsFromServer != null
                ? Math.max(waitMsFromServer, SEEDANCE_POLL_BASE_INTERVAL_MS)
                : Math.min(Math.round(currentIntervalMs * 1.8), 120000);
            scheduleNext(currentIntervalMs);
            return;
          }

          // 其它错误：仍继续轮询，但把间隔拉长一点，避免抖动
          currentIntervalMs = Math.min(Math.round(currentIntervalMs * 1.5), 60000);
          notifyVideoGen(
            false,
            normalizeErrorMessage(err?.message) || '查询 Seedance 任务状态失败'
          );
          scheduleNext(currentIntervalMs);
        }
      };

      scheduleNext(SEEDANCE_POLL_BASE_INTERVAL_MS);
      ElMessage.success('Seedance 任务已创建，开始生成…');
      return;
    }

    if (provider.value === 'pixverse') {
      if (imageSourceCount.value > 7) {
        ElMessage.warning('PixVerse 最多支持 7 张图片（请减少连线图片数量）。');
        loading.value = false;
        return;
      }

      const basePrompt = connectedPrompt.value || '生成一个简短的视频';

      const normalizePixverseAspectRatio = (ar: string) => {
        if (ar === '9:16') return '9.16';
        if (!ar || ar === 'adaptive' || ar === '21:9') return '16:9';
        return ar;
      };

      const normalizePixverseQuality = (q: string) => {
        // 前端可能保留 4k（给 kling），PixVerse 侧按 1080p 计费/生成
        if (q === '4k') return '1080p';
        return q;
      };

      const durationSeconds = getPixverseEffectiveDurationSeconds();
      if (pixverseMode.value === 'fusion_multi_subject') {
        const q = normalizePixverseQuality(resolution.value);
        const ok =
          durationSeconds === 5 ||
          durationSeconds === 8 ||
          (durationSeconds === 10 && q !== '1080p');
        if (!Number.isFinite(durationSeconds) || !ok) {
          ElMessage.error('多主体模式仅支持 5 / 8 / 10 秒，且 1080p 时不可选 10 秒');
          loading.value = false;
          return;
        }
      } else if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 15) {
        ElMessage.error('PixVerse duration 需在 1~15 秒范围内');
        loading.value = false;
        return;
      }

      // 通用请求字段（勿用 Record<string, unknown>，否则展开后不满足 PixVerse 各 API 的强类型参数）
      const commonPayload = withTemplateId({
        prompt: basePrompt,
        aspect_ratio: normalizePixverseAspectRatio(aspectRatio.value),
        duration: Math.round(durationSeconds),
        quality: normalizePixverseQuality(resolution.value),
        generate_audio_switch: true,
      });

      if (pixverseMode.value === 'text_to_video') {
        // 文生视频：禁止连接图片/视频/音频
        if (
          imageSourceCount.value > 0 ||
          connectedVideoRefUrls.value.length > 0 ||
          connectedAudioRefUrls.value.length > 0
        ) {
          ElMessage.warning('PixVerse 文生视频请不要连接图片/视频/音频参考。');
          loading.value = false;
          return;
        }

        markPendingBeforeRequest();
        const res = await createPixverseGeneration(commonPayload);
        const raw = (res as any);
        const d = raw?.data ?? raw;
        const videoId = Number(d?.video_id ?? d?.videoId ?? d?.id);
        if (!Number.isFinite(videoId)) {
          ElMessage.error('PixVerse 返回结果缺少 video_id');
          notifyVideoGen(false, 'PixVerse 返回结果缺少 video_id');
          return;
        }

        status.value = d?.status || 'pending';
        progress.value = d?.progress ?? null;
        videoUrls.value = [];

        taskId.value = videoId;
        seedanceTaskKey.value = null;

        syncResultVideoNode();
        clearPollTimer();
        startPollingPixverse(videoId);
        ElMessage.success('PixVerse 任务已创建，开始生成…');
        return;
      }

      if (pixverseMode.value === 'image_to_video_first_only') {
        // 图生：OpenAPI /video/img/generate 仅 img_id；多连线时只取首张
        if (imageSourceCount.value < 1 || imageSourceCount.value > 7 || !connectedImageUrl.value) {
          ElMessage.warning('PixVerse 图生视频请连接 1~7 张图片。');
          loading.value = false;
          return;
        }
        if (connectedVideoRefUrls.value.length > 0 || connectedAudioRefUrls.value.length > 0) {
          ElMessage.warning('PixVerse 图生视频不支持视频/音频参考。');
          loading.value = false;
          return;
        }

        const imageUrl = normalizeImageUrl(connectedImageUrl.value);

        markPendingBeforeRequest();
        const res = await createPixverseImageGeneration({
          mode: 'image_to_video_first_only',
          ...commonPayload,
          imageUrl,
        });

        creditTracker?.addSpent?.(executeCost.value);

        const raw = (res as any);
        const d = raw?.data ?? raw;

        const videoId = Number(d?.video_id ?? d?.videoId ?? d?.id);
        if (!Number.isFinite(videoId)) {
          ElMessage.error('PixVerse 返回结果缺少 video_id');
          notifyVideoGen(false, 'PixVerse 返回结果缺少 video_id');
          return;
        }

        status.value = d?.status || 'pending';
        progress.value = d?.progress ?? null;
        videoUrls.value = [];

        taskId.value = videoId;
        seedanceTaskKey.value = null;

        syncResultVideoNode();
        clearPollTimer();
        startPollingPixverse(videoId);
        ElMessage.success('PixVerse 任务已创建，开始生成…');
        return;
      }

      if (pixverseMode.value === 'fusion_multi_subject') {
        if (imageSourceCount.value < 2 || imageSourceCount.value > 7) {
          ElMessage.warning('PixVerse 多主体模式请连接 2~7 张图片。');
          loading.value = false;
          return;
        }
        if (connectedVideoRefUrls.value.length > 0 || connectedAudioRefUrls.value.length > 0) {
          ElMessage.warning('PixVerse 多主体模式不支持视频/音频参考。');
          loading.value = false;
          return;
        }
        if (!connectedImageUrls.value.length) {
          ElMessage.warning('未检测到连线图片列表，请重新连接图片节点。');
          loading.value = false;
          return;
        }

        const zipped = connectedImageUrls.value.slice(0, 7).map((u, i) => ({
          url: normalizeImageUrl(u),
          ref: connectedImageRefNames.value[i] ?? '',
          figure: connectedImageFigureNumbers.value[i] ?? i + 1,
        }));
        const filtered = zipped.filter((z) => typeof z.url === 'string' && z.url.trim());
        const imageUrls = filtered.map((z) => z.url);
        const imageRefNamesPayload = filtered.map((z) => z.ref);
        const imageFigureNumbersPayload = filtered.map((z) => z.figure);
        if (imageUrls.length < 2) {
          ElMessage.warning('PixVerse 多主体模式请至少连接两张有效图片。');
          loading.value = false;
          return;
        }

        markPendingBeforeRequest();
        const res = await createPixverseFusionGeneration({
          mode: 'fusion_multi_subject',
          ...commonPayload,
          imageUrls,
          imageRefNames:
            imageRefNamesPayload.length === imageUrls.length ? imageRefNamesPayload : undefined,
          imageFigureNumbers:
            imageFigureNumbersPayload.length === imageUrls.length ? imageFigureNumbersPayload : undefined,
        });

        creditTracker?.addSpent?.(executeCost.value);

        const raw = (res as any);
        const d = raw?.data ?? raw;

        const videoId = Number(d?.video_id ?? d?.videoId ?? d?.id);
        if (!Number.isFinite(videoId)) {
          ElMessage.error('PixVerse 返回结果缺少 video_id');
          notifyVideoGen(false, 'PixVerse 返回结果缺少 video_id');
          return;
        }

        status.value = d?.status || 'pending';
        progress.value = d?.progress ?? null;
        videoUrls.value = [];

        taskId.value = videoId;
        seedanceTaskKey.value = null;

        syncResultVideoNode();
        clearPollTimer();
        startPollingPixverse(videoId);
        ElMessage.success('PixVerse 任务已创建，开始生成…');
        return;
      }

      if (pixverseMode.value === 'image_to_video_first_last') {
        // 图生视频：首尾帧（2 张图）
        if (imageSourceCount.value !== 2 || !connectedImageUrl.value || !connectedEndImageUrl.value) {
          ElMessage.warning('PixVerse 图生视频（首尾帧）请连接两张图片（首帧/尾帧）。');
          loading.value = false;
          return;
        }
        if (connectedVideoRefUrls.value.length > 0 || connectedAudioRefUrls.value.length > 0) {
          ElMessage.warning('PixVerse 图生视频不支持视频/音频参考。');
          loading.value = false;
          return;
        }

        const imageUrl = normalizeImageUrl(connectedImageUrl.value);
        const endImageUrl = normalizeImageUrl(connectedEndImageUrl.value);

        markPendingBeforeRequest();
        const res = await createPixverseTransitionGeneration({
          mode: 'image_to_video_first_last',
          ...commonPayload,
          imageUrl,
          endImageUrl,
        });

        creditTracker?.addSpent?.(executeCost.value);

        const raw = (res as any);
        const d = raw?.data ?? raw;

        const videoId = Number(d?.video_id ?? d?.videoId ?? d?.id);
        if (!Number.isFinite(videoId)) {
          ElMessage.error('PixVerse 返回结果缺少 video_id');
          notifyVideoGen(false, 'PixVerse 返回结果缺少 video_id');
          return;
        }

        status.value = d?.status || 'pending';
        progress.value = d?.progress ?? null;
        videoUrls.value = [];

        taskId.value = videoId;
        seedanceTaskKey.value = null;

        syncResultVideoNode();
        clearPollTimer();
        startPollingPixverse(videoId);
        ElMessage.success('PixVerse 任务已创建，开始生成…');
        return;
      }

      ElMessage.warning('PixVerse 未知的生成类型');
      loading.value = false;
      return;
    }

    // Kling 流程
    markPendingBeforeRequest();
    const body: any = {
      mode: mode.value,
      prompt: connectedPrompt.value || '生成一个简短的视频',
      duration: durationAuto.value ? -1 : durationManual.value,
      resolution: resolution.value,
        aspectRatio: aspectRatio.value,
    };

    if (mode.value === 'image_to_video') {
      body.imageSubType = imageSubType.value;
      const firstUrl = connectedImageUrl.value;
      const endUrl = connectedEndImageUrl.value;

      if (imageSubType.value === 'first_only') {
        if (!firstUrl) {
          ElMessage.warning('请上传首帧或连接图片节点');
          loading.value = false;
          return;
        }
        body.imageUrl = normalizeImageUrl(firstUrl);
      } else if (imageSubType.value === 'first_last') {
        if (!firstUrl || !endUrl) {
          ElMessage.warning('请提供首帧与尾帧（上传或连线）');
          loading.value = false;
          return;
        }
        body.imageUrl = normalizeImageUrl(firstUrl);
        body.endImageUrl = normalizeImageUrl(endUrl);
      } else if (imageSubType.value === 'multi_shot') {
        if (connectedImageUrls.value.length < 2) {
          ElMessage.warning('多图多镜头请至少连接 2 张图片');
          loading.value = false;
          return;
        }
        body.imageUrls = connectedImageUrls.value.slice(0, 4).map(u => normalizeImageUrl(u));
      }
    }

    const res = await createVideoTask(withTemplateId(body)) as any;
    const t = (res?.data ?? res) as any;
    if (!t || typeof t !== 'object') {
      throw new Error('创建视频任务返回结果异常');
    }

    taskId.value = t.id;
    seedanceTaskKey.value = null;
    status.value = (t.status as any) || 'pending';
    progress.value = t.progress ?? null;
    videoUrls.value = Array.isArray(t.video_urls)
      ? t.video_urls.map((u: string) => normalizeImageUrl(u))
      : [];

    syncResultVideoNode();

    ElMessage.success('视频任务已创建，开始生成…');
    startPollingKling(t.id);
  } catch (e: any) {
    console.error('[VideoNode] 创建任务失败', e);

    // 若后端 429 并返回 retryAfter，则进入冷却期，避免连续点击再次触发限流
    const statusCode: number | undefined = e?.response?.status ?? e?.status;
    const retryAfterSeconds: number | undefined =
      typeof e?.response?.data?.retryAfter === 'number' ? e.response.data.retryAfter : undefined;
    if (statusCode === 429 && typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
      setGenerationCooldownSeconds(retryAfterSeconds);
    }

    // 失败时也同步到结果节点，显示错误状态与文案
    status.value = 'failed';
    errorMessage.value = normalizeErrorMessage(e?.message) || '创建视频任务失败';
    syncResultVideoNode();
    notifyVideoGen(false, errorMessage.value);
    // 统一错误提示交给全局拦截器，这里不再重复 toast
  } finally {
    loading.value = false;
    generationInFlight.value = false;
  }
};

const manualRefresh = async () => {
  if (!taskId.value) return;
  try {
    if (provider.value === 'kling') {
      const res = await getVideoTask(taskId.value) as any;
      const t = (res?.data ?? res) as any;
      status.value = (t.status as any) || 'pending';
      progress.value = t?.progress ?? null;
      errorMessage.value = normalizeErrorMessage(t?.error_message);
      videoUrls.value = Array.isArray(t?.video_urls)
        ? t.video_urls.map((u: string) => normalizeImageUrl(u))
        : [];
      syncResultVideoNode();
    } else if (provider.value === 'pixverse') {
      const res = await getPixverseGenerationStatus(taskId.value) as any;
      const d = res?.data ?? res;
      status.value = (d.status as any) || 'pending';
      progress.value = d?.progress ?? null;
      errorMessage.value = normalizeErrorMessage(d?.errorMessage);
      const u = d?.videoUrl;
      videoUrls.value = typeof u === 'string' && u.trim() ? [normalizeMediaUrl(u)] : [];
      syncResultVideoNode();
    }
  } catch (e: any) {
    console.error('[VideoNode] 手动刷新失败', e);
    // 统一错误提示交给全局拦截器
  }
};

const handleOpenFullscreen = (url: string) => {
  if (!url) return;
  fullscreenUrl.value = url;
  showFullscreen.value = true;
};

const handleCloseFullscreen = () => {
  showFullscreen.value = false;
  fullscreenUrl.value = null;
};

const handleVideoClick = (event: MouseEvent, url: string) => {
  if (!url) return;
  const target = event.currentTarget as HTMLVideoElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const controlHeight = 48; // 估计控制条高度，避免点到控制条时误触全屏
  if (event.clientY < rect.bottom - controlHeight) {
    // 阻止默认点击行为，避免节点内视频同时播放/暂停
    event.preventDefault();
    event.stopPropagation();
    try {
      target.pause();
    } catch {}
    handleOpenFullscreen(url);
  }
};

const downloadVideo = (url: string) => {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kling-video.mp4';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

onMounted(() => {
  // 历史恢复场景：刷新后 workflow/节点可能是异步 setNodes，
  // 因此用有限重试确保拿到 videoResult 节点并启动轮询。
  let restoreTries = 0;
  const MAX_TRIES = 12; // 12 * 300ms = 3.6s

  const tryRestore = async () => {
    try {
      const selfNode = getNodes.value.find(n => n.id === props.id);
      const selfVideoTask = (selfNode?.data as any)?.__videoTask as any;
      const preferredResultId =
        typeof selfVideoTask?.activeResultNodeId === 'string' ? selfVideoTask.activeResultNodeId : null;

      const candidates = getNodes.value.filter(
        n => n.type === 'videoResult' && (n.data as any)?.fromNodeId === props.id
      );

      let resultNode = preferredResultId
        ? candidates.find(n => n.id === preferredResultId)
        : undefined;
      if (!resultNode && candidates.length === 1) {
        resultNode = candidates[0];
      } else if (!resultNode && candidates.length > 1) {
        resultNode = [...candidates].sort(
          (a, b) =>
            b.position.y + (b.dimensions?.height ?? VIDEO_RESULT_EST_HEIGHT) -
            (a.position.y + (a.dimensions?.height ?? VIDEO_RESULT_EST_HEIGHT))
        )[0];
      }
      if (resultNode) {
        activeVideoResultNodeId.value = resultNode.id;
      }

      // 优先使用 videoResult；若尚未渲染/快照不完整，则回退到 VideoNode 自身数据
      const resultData = resultNode?.data as any;

      // 两份快照都拿不到：继续重试
      if (!resultData && !selfVideoTask) return false;

      const d = resultData || selfVideoTask || {};

      // 还原核心展示状态
      if (typeof d.status === 'string') status.value = d.status as any;
      if (typeof d.progress === 'number') progress.value = d.progress;
      if (typeof d.errorMessage === 'string') errorMessage.value = d.errorMessage;

      if (typeof d.videoUrl === 'string' && d.videoUrl.trim()) {
        videoUrls.value = [normalizeMediaUrl(d.videoUrl)];
      } else {
        videoUrls.value = [];
      }

      // 还原任务元信息（用于恢复轮询）
      // 兼容：历史数据里可能没有 taskMeta（旧版本/中途保存快照）
      const taskMeta = d.taskMeta as any;
      const legacyTaskIdNum =
        typeof d.taskId === 'number'
          ? d.taskId
          : typeof d.taskId === 'string'
            ? Number(d.taskId)
            : null;
      const legacySeedanceTaskKey =
        typeof d.seedanceTaskKey === 'string' ? d.seedanceTaskKey : null;
      const legacyProvider = d.provider;

      const metaProvider = taskMeta?.provider ?? legacyProvider;
      if (metaProvider === 'kling' || metaProvider === 'seedance' || metaProvider === 'pixverse') {
        provider.value = metaProvider;
      }

      const metaTaskIdNum =
        typeof taskMeta?.taskId === 'number'
          ? taskMeta.taskId
          : typeof taskMeta?.taskId === 'string'
            ? Number(taskMeta.taskId)
            : null;

      taskId.value = metaTaskIdNum != null ? metaTaskIdNum : legacyTaskIdNum;
      seedanceTaskKey.value =
        typeof taskMeta?.seedanceTaskKey === 'string'
          ? taskMeta.seedanceTaskKey
          : legacySeedanceTaskKey;

      // 兜底：如果有 videoUrl，但状态卡在进行中，则直接修正为 succeeded
      const activeStates = new Set(['pending', 'running', 'queued']);
      const terminalStates = new Set(['succeeded', 'failed', 'canceled']);
      if (activeStates.has(status.value) && videoUrls.value.length > 0) {
        status.value = 'succeeded';
        errorMessage.value = null;
        syncResultVideoNode();
        saveWorkflowImmediately();
      }

      // 恢复轮询：只有处于“进行中”且带任务 key 的情况才重新拉取
      const shouldPoll = !terminalStates.has(status.value) && activeStates.has(status.value);
      if (!shouldPoll) return true;

      // 进行中但缺少任务标识：继续重试（等待快照补全）
      if (
        provider.value === 'kling' &&
        (typeof taskId.value !== 'number' || Number.isNaN(taskId.value))
      ) {
        return false;
      }
      if (
        provider.value === 'seedance' &&
        (typeof seedanceTaskKey.value !== 'string' || !seedanceTaskKey.value)
      ) {
        return false;
      }

      if (
        provider.value === 'pixverse' &&
        (typeof taskId.value !== 'number' || Number.isNaN(taskId.value))
      ) {
        return false;
      }

      if (provider.value === 'kling' && typeof taskId.value === 'number' && !Number.isNaN(taskId.value)) {
        startPollingKling(taskId.value, { silent: true });
        return true;
      }

      if (
        provider.value === 'seedance' &&
        typeof seedanceTaskKey.value === 'string' &&
        seedanceTaskKey.value
      ) {
        startPollingSeedance(seedanceTaskKey.value, { silent: true });
        return true;
      }

      if (
        provider.value === 'pixverse' &&
        typeof taskId.value === 'number' &&
        !Number.isNaN(taskId.value)
      ) {
        startPollingPixverse(taskId.value, { silent: true });
        return true;
      }

      // 没有拿到 taskId/taskKey，也就没法轮询；但 state 已恢复到当前快照
      return true;
    } catch (e: any) {
      console.error('[VideoNode] 历史恢复轮询失败', e);
      return false;
    }
  };

  const loop = async () => {
    restoreTries += 1;
    await nextTick();
    const ok = await tryRestore();
    if (ok) return;
    if (restoreTries >= MAX_TRIES) return;
    setTimeout(() => void loop(), 300);
  };

  void loop();
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearGenerationCooldownTimer();
});
</script>

<style scoped>
.video-node .nodrag {
  cursor: auto;
}

.video-node {
  background: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 30px;
  width: 360px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
}

.video-node :deep(.vue-flow__handle) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.video-node:hover :deep(.vue-flow__handle) {
  opacity: 1;
  pointer-events: auto;
}

.node-header {
  background: #3a3a3f;
  border-bottom: 1px solid #404040;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: bold;
  color: #e0e0e0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-tag {
  margin-left: auto;
}

.node-content {
  padding: 14px 14px 12px;
  color: #b0b0b0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.params-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.param-label {
  font-size: 12px;
  color: #b0b0b0;
  min-width: 72px;
}

.param-select {
  width: 150px;
}

.param-input {
  flex: 1;
}

.image-input-row {
  align-items: flex-start;
}

.image-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.image-slot .thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #404040;
}

.image-slot .placeholder {
  font-size: 12px;
  color: #808080;
  min-width: 60px;
}

.hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.param-hint {
  font-size: 12px;
  color: #b0b0b0;
}

.param-hint.warn {
  display: block;
  margin-top: 2px;
  color: #e6a23c;
}

.execute-btn {
  width: 100%;
  margin-top: 4px;
}

.result-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #404040;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.status-label {
  color: #b0b0b0;
}

.status-value {
  font-weight: 500;
}

.status-pending,
.status-running {
  color: #e6a23c;
}

.status-succeeded {
  color: #67c23a;
}

.status-failed {
  color: #f56c6c;
}

.status-canceled {
  color: #909399;
}

.error-row {
  font-size: 12px;
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.16);
  border-radius: 6px;
  padding: 6px 8px;
}

/* 统一表单控件深色样式 */
.video-node :deep(.el-input__wrapper),
.video-node :deep(.el-textarea__inner),
.video-node :deep(.el-select__wrapper),
.video-node :deep(.el-input-number__decrease),
.video-node :deep(.el-input-number__increase) {
  background-color: #252525;
  border-color: #404040;
  box-shadow: none;
  color: #b0b0b0;
}

.video-node :deep(.el-input__inner),
.video-node :deep(.el-select__placeholder),
.video-node :deep(.el-input-number__input) {
  color: #b0b0b0;
}

.video-node :deep(.el-input__inner::placeholder),
.video-node :deep(.el-textarea__inner::placeholder) {
  color: #808080;
}

.video-node :deep(.el-input__wrapper.is-focus),
.video-node :deep(.el-select__wrapper.is-focused) {
  border-color: #409eff;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.35);
}

.player-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.video-player {
  width: 100%;
  border-radius: 10px;
  background: #000;
  max-height: 220px;
}

.player-actions {
  display: flex;
  justify-content: flex-end;
}

/* 全屏视频预览样式 */
.fullscreen-video-dialog {
  margin: 0 !important;
  padding: 0 !important;
}

.fullscreen-video-dialog :deep(.el-dialog) {
  width: 100vw !important;
  height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  background: rgba(0, 0, 0, 0.95) !important;
  border-radius: 0 !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  z-index: 10000 !important;
}

.fullscreen-video-dialog :deep(.el-dialog__header) {
  padding: 0 !important;
  margin: 0 !important;
  height: 0 !important;
  overflow: hidden;
}

.fullscreen-video-dialog :deep(.el-dialog__body) {
  padding: 0 !important;
  margin: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
}

:deep(.fullscreen-video-overlay) {
  position: fixed !important;
  inset: 0 !important;
  overflow: hidden !important;
}

.fullscreen-video-container {
  width: 100vw !important;
  height: 100vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer;
  position: relative;
  overflow: hidden !important;
}

.fullscreen-video {
  max-width: 95vw !important;
  max-height: 95vh !important;
  background: #000;
}
</style>
