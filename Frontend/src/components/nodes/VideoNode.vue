<template>
  <div class="video-node">
    <div class="node-header">
      <el-icon><VideoCamera /></el-icon>
      <span>可灵 · 视频生成</span>
    </div>

    <div class="node-content">
      <!-- 上半部分：参数表单 -->
      <div class="params-section">
        <div class="param-item">
          <div class="param-label">模式</div>
          <el-select v-model="mode" size="small" class="param-select">
            <el-option label="文生视频" value="text_to_video" />
            <el-option label="图生视频" value="image_to_video" />
          </el-select>
        </div>

        <!-- 图生视频子模式 -->
        <div v-if="mode === 'image_to_video'" class="param-item">
          <div class="param-label">图生类型</div>
          <el-select v-model="imageSubType" size="small" class="param-select">
            <el-option label="仅首帧" value="first_only" />
            <el-option label="首尾帧（一镜到底）" value="first_last" />
            <el-option label="多图多镜头" value="multi_shot" />
          </el-select>
        </div>

        <!-- 首帧：仅首帧 或 首尾帧 时显示 -->
        <template v-if="mode === 'image_to_video' && (imageSubType === 'first_only' || imageSubType === 'first_last')">
          <div class="param-item image-input-row">
            <div class="param-label">首帧</div>
            <div class="image-slot">
              <img v-if="firstFramePreview" :src="firstFramePreview" class="thumb" alt="首帧" />
              <span v-else class="placeholder">上传或连线</span>
              <el-button size="small" type="primary" plain @click="triggerUploadFirst">上传</el-button>
              <input ref="uploadFirstRef" type="file" accept="image/*" class="hidden-input" @change="onFirstFileChange" />
            </div>
          </div>
          <!-- 尾帧：仅首尾帧时显示 -->
          <div v-if="imageSubType === 'first_last'" class="param-item image-input-row">
            <div class="param-label">尾帧</div>
            <div class="image-slot">
              <img v-if="endFramePreview" :src="endFramePreview" class="thumb" alt="尾帧" />
              <span v-else class="placeholder">上传或连线</span>
              <el-button size="small" type="primary" plain @click="triggerUploadEnd">上传</el-button>
              <input ref="uploadEndRef" type="file" accept="image/*" class="hidden-input" @change="onEndFileChange" />
            </div>
          </div>
        </template>

        <!-- 多图多镜头：展示已汇聚的图片数量 -->
        <div v-if="mode === 'image_to_video' && imageSubType === 'multi_shot'" class="param-item">
          <div class="param-label">多图</div>
          <span class="param-hint">{{ connectedImageUrls.length }} 张（连线或上传）</span>
        </div>

        <div class="param-item">
          <div class="param-label">时长(秒)</div>
          <el-input-number v-model="duration" :min="3" :max="20" size="small" />
        </div>

        <div class="param-item">
          <div class="param-label">分辨率</div>
          <el-select v-model="resolution" size="small" class="param-select">
            <el-option label="720p" value="720p" />
            <el-option label="1080p" value="1080p" />
          </el-select>
        </div>

        <div class="param-item">
          <div class="param-label">比例</div>
          <el-select v-model="aspectRatio" size="small" class="param-select">
            <el-option label="16:9 横版" value="16:9" />
            <el-option label="9:16 竖版" value="9:16" />
            <el-option label="1:1 方形" value="1:1" />
          </el-select>
        </div>

        <div class="param-item">
          <div class="param-label">风格</div>
          <el-input
            v-model="style"
            size="small"
            placeholder="如 写实 / 动漫 / 产品展示"
            class="param-input"
          />
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { VideoCamera } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { createVideoTask, getVideoTask, type VideoMode, type ImageSubType } from '@/api/video';
import { uploadImage } from '@/api/upload';

defineEmits<{
  updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();
const { getEdges, findNode } = useVueFlow();

// 输入：从上游节点采集的提示词 & 图片
const connectedPrompt = ref('');
const connectedImageUrl = ref<string | null>(null);
const connectedEndImageUrl = ref<string | null>(null);
const connectedImageUrls = ref<string[]>([]);

// 节点内上传的首帧/尾帧 URL（相对路径如 /uploads/xxx）
const uploadedFirstUrl = ref<string | null>(null);
const uploadedEndUrl = ref<string | null>(null);

const uploadFirstRef = ref<HTMLInputElement | null>(null);
const uploadEndRef = ref<HTMLInputElement | null>(null);

// 表单状态（imageSubType 需在 watch 前声明）
const mode = ref<VideoMode>('text_to_video');
const imageSubType = ref<ImageSubType>('first_only');

// 监听连接变化，提取提示词和图片（支持首帧、尾帧、多图）
watch(
  () => [getEdges.value, imageSubType.value],
  () => {
    const edges = getEdges.value;
    const targetEdges = edges.filter(e => e.target === props.id);

    connectedPrompt.value = '';
    connectedImageUrl.value = null;
    connectedEndImageUrl.value = null;
    connectedImageUrls.value = [];

    const imageSources: string[] = [];
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
    }

  if (imageSubType.value === 'multi_shot') {
    connectedImageUrls.value = [...new Set(imageSources)];
    if (imageSources.length > 0) {
      connectedImageUrl.value = imageSources[0] ?? null;
    }
  } else {
    if (imageSources.length > 0) {
      connectedImageUrl.value = imageSources[0] ?? null;
    }
    if (imageSources.length > 1) {
      connectedEndImageUrl.value = imageSources[1] ?? null;
    }
  }
  },
  { immediate: true, deep: true }
);

// 表单状态（其余）
const duration = ref<number>(6);
const resolution = ref<'720p' | '1080p' | '4k'>('720p');
const aspectRatio = ref<string>('16:9');
const style = ref('');

const normalizeImageUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) return `${window.location.origin}${url}`;
  return `${window.location.origin}/uploads/${url}`;
};

// 首帧/尾帧预览用 URL（连线优先，否则用上传的）
const firstFramePreview = computed(() => {
  const u = connectedImageUrl.value || uploadedFirstUrl.value;
  return u ? normalizeImageUrl(u) : '';
});
const endFramePreview = computed(() => {
  const u = connectedEndImageUrl.value || uploadedEndUrl.value;
  return u ? normalizeImageUrl(u) : '';
});

const triggerUploadFirst = () => uploadFirstRef.value?.click();
const triggerUploadEnd = () => uploadEndRef.value?.click();

const onFirstFileChange = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const res: any = await uploadImage(file);
    const url = res?.data?.url;
    if (url) {
      uploadedFirstUrl.value = url;
      ElMessage.success('首帧上传成功');
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '首帧上传失败');
  }
  input.value = '';
};

const onEndFileChange = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const res: any = await uploadImage(file);
    const url = res?.data?.url;
    if (url) {
      uploadedEndUrl.value = url;
      ElMessage.success('尾帧上传成功');
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '尾帧上传失败');
  }
  input.value = '';
};

// 任务状态
const taskId = ref<number | null>(null);
const status = ref<'pending' | 'running' | 'succeeded' | 'failed' | 'canceled'>('pending');
const progress = ref<number | null>(null);
const errorMessage = ref<string | null>(null);
const videoUrls = ref<string[]>([]);

const loading = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

// 是否可以执行
const canExecute = computed(() => {
  if (mode.value === 'text_to_video') {
    return !!connectedPrompt.value;
  }
  if (mode.value === 'image_to_video') {
    const first = !!(connectedImageUrl.value || uploadedFirstUrl.value);
    if (imageSubType.value === 'first_only') return !!connectedPrompt.value && first;
    if (imageSubType.value === 'first_last') {
      const end = !!(connectedEndImageUrl.value || uploadedEndUrl.value);
      return !!connectedPrompt.value && first && end;
    }
    if (imageSubType.value === 'multi_shot') {
      return !!connectedPrompt.value && connectedImageUrls.value.length >= 2;
    }
  }
  return !!connectedPrompt.value || !!(connectedImageUrl.value || uploadedFirstUrl.value);
});

const executeButtonText = computed(() => {
  if (status.value === 'succeeded' && videoUrls.value.length > 0) {
    return '重新生成视频';
  }
  return '生成视频';
});

// 根据连接自动调整模式：有图片则优先图生视频
watch(
  () => connectedImageUrl.value,
  (val) => {
    if (val) {
      mode.value = 'image_to_video';
    } else if (mode.value === 'image_to_video') {
      mode.value = 'text_to_video';
    }
  },
  { immediate: true }
);

const startPolling = (id: number) => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await getVideoTask(id);
      const t = res.data;
      status.value = (t.status as any) || 'pending';
      progress.value = t.progress;
      errorMessage.value = t.error_message;

      if (Array.isArray(t.video_urls) && t.video_urls.length > 0) {
        videoUrls.value = t.video_urls.map(u => normalizeImageUrl(u));
      }

      if (['succeeded', 'failed', 'canceled'].includes(status.value)) {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
    } catch (e: any) {
      console.error('[VideoNode] 轮询失败', e);
    }
  }, 5000);
};

const handleGenerate = async () => {
  if (!canExecute.value) {
    ElMessage.warning('请补全提示词与图片输入');
    return;
  }

  loading.value = true;
  errorMessage.value = null;

  try {
    const body: any = {
      mode: mode.value,
      prompt: connectedPrompt.value || '生成一个简短的视频',
      duration: duration.value,
      resolution: resolution.value,
      aspectRatio: aspectRatio.value,
      style: style.value || undefined,
    };

    if (mode.value === 'image_to_video') {
      body.imageSubType = imageSubType.value;
      const firstUrl = connectedImageUrl.value || uploadedFirstUrl.value;
      const endUrl = connectedEndImageUrl.value || uploadedEndUrl.value;

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

    const res = await createVideoTask(body);
    const t = res.data;
    taskId.value = t.id;
    status.value = (t.status as any) || 'pending';
    progress.value = t.progress;
    videoUrls.value = Array.isArray(t.video_urls)
      ? t.video_urls.map(u => normalizeImageUrl(u))
      : [];

    ElMessage.success('视频任务已创建，开始生成…');
    startPolling(t.id);
  } catch (e: any) {
    console.error('[VideoNode] 创建任务失败', e);
    ElMessage.error(e?.message || '创建视频任务失败');
  } finally {
    loading.value = false;
  }
};

const manualRefresh = async () => {
  if (!taskId.value) return;
  try {
    const res = await getVideoTask(taskId.value);
    const t = res.data;
    status.value = (t.status as any) || 'pending';
    progress.value = t.progress;
    errorMessage.value = t.error_message;
    videoUrls.value = Array.isArray(t.video_urls)
      ? t.video_urls.map(u => normalizeImageUrl(u))
      : [];
  } catch (e: any) {
    console.error('[VideoNode] 手动刷新失败', e);
    ElMessage.error(e?.message || '刷新任务状态失败');
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

.node-content {
  padding: 14px 14px 12px;
  color: #e0e0e0;
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
  background: rgba(245, 108, 108, 0.1);
  border-radius: 6px;
  padding: 6px 8px;
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
</style>
