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
      <!-- 上半部分：参数表单 -->
      <div class="params-section">
        <div class="param-item">
          <div class="param-label">模型</div>
          <el-select v-model="provider" size="small" class="param-select" disabled>
            <!-- 目前仅支持 Seedance，暂时禁用 Kling 选项 -->
            <el-option label="Seedance" value="seedance" />
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
              v-model="durationAuto"
              inline-prompt
              active-text="自动"
              inactive-text="自定义"
              size="small"
            />
            <el-input-number
              v-model="durationManual"
              :min="4"
              :max="15"
              :step="1"
              size="small"
              :disabled="durationAuto"
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
            <template v-else>
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
            </template>
          </el-select>
        </div>

        <div class="param-item">
          <div class="param-label">比例</div>
          <el-select v-model="aspectRatio" size="small" class="param-select">
            <el-option label="自适应 (adaptive)" value="adaptive" />
            <el-option label="16:9" value="16:9" />
            <el-option label="4:3" value="4:3" />
            <el-option label="1:1" value="1:1" />
            <el-option label="3:4" value="3:4" />
            <el-option label="9:16" value="9:16" />
            <el-option label="21:9" value="21:9" />
          </el-select>
        </div>

        <el-button
          type="primary"
          size="default"
          class="execute-btn"
          :loading="loading"
          :disabled="!canExecute"
          @click="handleGenerate"
        >
          {{ executeButtonText }}
        </el-button>
      </div>

      <!-- 下半部分：任务状态 & 播放器 -->
      <div class="result-section" v-if="taskId">
        <div class="status-row">
          <span class="status-label">状态</span>
          <span class="status-value" :class="`status-${status}`">
            {{ statusText }}
          </span>
          <el-tag v-if="progress != null" size="small" effect="dark">
            {{ progress }}%
          </el-tag>
          <el-button
            v-if="status === 'pending' || status === 'running'"
            size="small"
            text
            @click="manualRefresh"
          >
            刷新
          </el-button>
        </div>

        <div v-if="errorMessage" class="error-row">
          {{ errorMessage }}
        </div>

        <div v-if="videoUrls.length" class="player-wrapper">
          <video
            :src="videoUrls[0]"
            controls
            class="video-player"
            @click.stop="handleVideoClick($event, videoUrls[0] || '')"
          />
          <div class="player-actions">
            <el-button
              v-if="videoUrls[0]"
              size="small"
              @click="downloadVideo(videoUrls[0])"
            >
              下载视频
            </el-button>
          </div>
        </div>
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
import { ref, computed, watch, onMounted, onUnmounted, inject } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { VideoCamera } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { createVideoTask, getVideoTask, type VideoMode, type ImageSubType } from '@/api/video';
import { getUploadUrl } from '@/utils/image-loader';
import { createSeedanceGeneration, getSeedanceGenerationStatus, createSeedanceAdvanced, type SeedanceAdvancedAction } from '@/api/seedance';
import { probeMediaUrl } from '@/api/media';
import { useUserStore } from '@/store/user';
import { notifyMediaGeneration } from '@/utils/browser-notification';

defineEmits<{
  updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();
const { getEdges, findNode, addNodes, addEdges, getNodes } = useVueFlow();
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

// 模型提供方：kling / seedance（Seedance 仅支持文生视频）
const provider = ref<'kling' | 'seedance'>('seedance');

// Seedance 内部模式：文生 / 图生首帧 / 首尾帧 / 多参考图
const seedanceMode = ref<SeedanceAdvancedAction>('text');

// 输入：从上游节点采集的提示词 & 图片 / 视频 / 音频参考
const connectedPrompt = ref('');
const connectedImageUrl = ref<string | null>(null);
const connectedEndImageUrl = ref<string | null>(null);
const connectedImageUrls = ref<string[]>([]);
const imageSourceCount = ref(0);

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

// 创建或更新“视频结果节点”：从创建任务开始就存在，并在轮询过程中实时同步状态
const syncResultVideoNode = () => {
  const self = currentNode.value;
  if (!self) return;

  const url = videoUrls.value[0] || '';

  // 若已存在当前 VideoNode 派生的结果节点，则直接更新其数据
  const existing = getNodes.value.find(
    n => n.type === 'videoResult' && (n.data as any)?.fromNodeId === props.id
  );
  if (existing) {
    existing.data = {
      ...(existing.data || {}),
      fromNodeId: props.id,
      videoUrl: url,
      status: status.value,
      progress: progress.value,
      errorMessage: errorMessage.value,
    };
    saveWorkflowImmediately();
    return;
  }

  // 否则创建新的结果节点（即使此时还没有 videoUrl）
  const nodeWidth = self.dimensions?.width || 360;
  const startX = self.position.x + nodeWidth + 100;
  const startY = self.position.y;

  const nodeId = `video_result_${Date.now()}`;
  const edgeId = `edge_${props.id}_to_${nodeId}_${Date.now()}`;

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
    },
  });

  addEdges({
    id: edgeId,
    source: props.id,
    target: nodeId,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'default',
    animated: true,
  });

  // 新建结果节点后立即保存一次工作流，避免用户在首次创建结果节点后立刻刷新导致该节点未写入历史记录
  saveWorkflowImmediately();
};

// 表单状态（imageSubType 需在 watch 前声明）
const mode = ref<VideoMode>('text_to_video');
const imageSubType = ref<ImageSubType>('first_only');

// 监听连接变化，提取提示词、图片、视频参考、音频参考
watch(
  () => [getEdges.value, imageSubType.value],
  () => {
    const edges = getEdges.value;
    const targetEdges = edges.filter(e => e.target === props.id);

    connectedPrompt.value = '';
    connectedImageUrl.value = null;
    connectedEndImageUrl.value = null;
    connectedImageUrls.value = [];
    connectedVideoRefUrls.value = [];
    connectedAudioRefUrls.value = [];
    connectedVideoRefMeta.value = [];
    connectedAudioRefMeta.value = [];

    const imageSources: string[] = [];
    const videoRefSources: string[] = [];
    const audioRefSources: string[] = [];
    const videoRefMetaSources: MediaRefMeta[] = [];
    const audioRefMetaSources: MediaRefMeta[] = [];
    for (const edge of targetEdges) {
      const sourceNode = findNode(edge.source);
      if (!sourceNode) continue;

      if (sourceNode.type === 'prompt' && sourceNode.data?.text && !connectedPrompt.value) {
        connectedPrompt.value = sourceNode.data.text as string;
      }

      if (sourceNode.type === 'image' && sourceNode.data?.imageUrl) {
        const url = sourceNode.data.imageUrl as string;
        if (typeof url === 'string' && url) imageSources.push(url);
      }
      if (sourceNode.data?.imageUrls && Array.isArray(sourceNode.data.imageUrls)) {
        for (const u of sourceNode.data.imageUrls) {
          if (typeof u === 'string' && u) imageSources.push(u);
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

    // Kling 多图多镜头：把所有图片作为序列
    if (provider.value === 'kling' && imageSubType.value === 'multi_shot') {
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
        ElMessage.info('检测到已连接图片或视频/音频参考，已自动切换到 Seedance 多模态参考模式。');
      }

      // 首帧模式：如果图片数量 >1，或连入了视频/音频，也自动切到多模态
      if (
        seedanceMode.value === 'image_first_frame' &&
        (hasExtraImagesForFirst || hasVideoRefs || hasAudioRefs)
      ) {
        seedanceMode.value = 'multi_modal';
        ElMessage.info('首帧模式仅支持 1 张图片，检测到多张图片或视频/音频参考，已自动切换为多模态参考模式。');
      }

      // 首帧+尾帧模式：如果图片数量 >2，或连入了视频/音频，也自动切到多模态
      if (
        seedanceMode.value === 'image_first_last' &&
        (hasExtraImagesForFirstLast || hasVideoRefs || hasAudioRefs)
      ) {
        seedanceMode.value = 'multi_modal';
        ElMessage.info('首帧+尾帧模式仅支持 2 张图片，检测到更多图片或视频/音频参考，已自动切换为多模态参考模式。');
      }
    }
  },
  { immediate: true, deep: true }
);

// 表单状态（其余）
// 时长：自动(-1) 或手动 4-15 秒
const durationAuto = ref(false);
const durationManual = ref<number>(4);
const resolution = ref<'720p' | '1080p' | '4k'>('720p');
const aspectRatio = ref<string>('adaptive');

const providerLabel = computed(() => (provider.value === 'kling' ? 'Kling' : 'Seedance'));

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
const showFullscreen = ref(false);
const fullscreenUrl = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

function getSeedanceCreditsPerSecond(): number {
  // 与后端默认保持一致：20 积分 / 秒；如前端配置了 VITE_SEEDANCE_CREDITS_PER_SECOND 则优先使用
  const raw = (import.meta as any)?.env?.VITE_SEEDANCE_CREDITS_PER_SECOND;
  const n = raw != null ? Number(raw) : 20;
  if (Number.isNaN(n) || n <= 0) return 20;
  return n;
}

function getSeedanceDefaultDurationSeconds(): number {
  // 与后端默认保持一致：5 秒；如前端配置了 VITE_SEEDANCE_DEFAULT_DURATION 则优先使用
  const raw = (import.meta as any)?.env?.VITE_SEEDANCE_DEFAULT_DURATION;
  const n = raw != null ? Number(raw) : 5;
  if (Number.isNaN(n) || n <= 0) return 5;
  return n;
}

const executeCost = computed(() => {
  if (provider.value !== 'seedance') return 0;
  const seconds = durationAuto.value ? getSeedanceDefaultDurationSeconds() : Number(durationManual.value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds) * getSeedanceCreditsPerSecond();
});

const canAfford = computed(() => {
  if (userStore.userInfo?.role === 1) return true;
  const need = executeCost.value;
  if (need <= 0) return true;
  return (userStore.userInfo?.credits ?? 0) >= need;
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
  return inputReady.value && canAfford.value;
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

const startPollingKling = (id: number) => {
  if (pollTimer) clearInterval(pollTimer);
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

      if (['succeeded', 'failed', 'canceled'].includes(status.value)) {
        syncResultVideoNode();
        saveWorkflowImmediately();

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

        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    } catch (e: any) {
      console.error('[VideoNode] 轮询失败', e);
      notifyVideoGen(
        false,
        normalizeErrorMessage(e?.message) || '查询视频任务状态失败'
      );
    }
  }, 5000);
};

const handleGenerate = async () => {
  if (!inputReady.value) {
    ElMessage.warning('请补全提示词与图片输入');
    return;
  }
  if (!canAfford.value) {
    ElMessage.warning('积分不足，请向超级管理员申请');
    return;
  }

  loading.value = true;
  errorMessage.value = null;

  // 无论后端是否成功，先创建 / 更新一次结果节点，显示“排队中”
  status.value = 'pending';
  progress.value = null;
  syncResultVideoNode();

  try {
    if (provider.value === 'seedance') {
      const basePrompt = connectedPrompt.value || '微距镜头对准树上鲜艳的花瓣，逐渐放大。';

      // 纯文生视频仍走简单接口
      if (seedanceMode.value === 'text') {
        const payload = {
          prompt: basePrompt,
          ratio: aspectRatio.value,
          duration: durationAuto.value ? -1 : durationManual.value,
          resolution: resolution.value,
          generateAudio: true,
          enableWebSearch: false,
        };
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
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        const SEEDANCE_POLL_INTERVAL_MS = 8000;
        const SEEDANCE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
        const seedanceStartTs = Date.now();
        pollTimer = setInterval(async () => {
          try {
            const r = await getSeedanceGenerationStatus(taskKeySimple);
            const rawStatus = (r as any);
            const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
            if (!data) return;
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

            const shouldStopByTerminalState =
              nextStatus === 'failed' || nextStatus === 'canceled';
            const shouldStopBySuccess =
              nextStatus === 'succeeded' && hasVideoUrl;

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

              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
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
              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
              return;
            }
          } catch (err: any) {
            console.error('[VideoNode] Seedance 轮询失败', err);
            notifyVideoGen(
              false,
              normalizeErrorMessage(err?.message) || '查询 Seedance 任务状态失败'
            );
          }
        }, SEEDANCE_POLL_INTERVAL_MS);
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

      const res = await createSeedanceAdvanced(payloadAdv);
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
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      const SEEDANCE_POLL_INTERVAL_MS = 8000;
      const SEEDANCE_POLL_MAX_WAIT_MS = 60 * 60 * 1000; // 最多等待 60 分钟
      const seedanceStartTs = Date.now();
      pollTimer = setInterval(async () => {
        try {
          const r = await getSeedanceGenerationStatus(taskKey);
          const rawStatus = (r as any);
          const data = rawStatus?.data?.data ?? rawStatus?.data ?? rawStatus;
          if (!data) return;

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

          const shouldStopByTerminalState =
            nextStatus === 'failed' || nextStatus === 'canceled';
          const shouldStopBySuccess =
            nextStatus === 'succeeded' && hasVideoUrl;

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

            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
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
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            return;
          }
        } catch (err: any) {
          console.error('[VideoNode] Seedance 轮询失败', err);
          notifyVideoGen(
            false,
            normalizeErrorMessage(err?.message) || '查询 Seedance 任务状态失败'
          );
        }
      }, SEEDANCE_POLL_INTERVAL_MS);
      ElMessage.success('Seedance 任务已创建，开始生成…');
      return;
    }

    // Kling 流程
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

    const res = await createVideoTask(body) as any;
    const t = (res?.data ?? res) as any;
    if (!t || typeof t !== 'object') {
      throw new Error('创建视频任务返回结果异常');
    }

    taskId.value = t.id;
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
    // 失败时也同步到结果节点，显示错误状态与文案
    status.value = 'failed';
    errorMessage.value = normalizeErrorMessage(e?.message) || '创建视频任务失败';
    syncResultVideoNode();
    notifyVideoGen(false, errorMessage.value);
    // 统一错误提示交给全局拦截器，这里不再重复 toast
  } finally {
    loading.value = false;
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
  // 如果节点已携带历史任务数据，可在此恢复（预留扩展）
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
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
