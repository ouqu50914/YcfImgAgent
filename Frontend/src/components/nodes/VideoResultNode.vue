<template>
  <div
    class="video-result-node"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <!-- 名称 + 尺寸/状态：显示在媒体上方（可拖拽节点） -->
    <div class="media-meta">
      <div class="meta-left">
        <el-icon class="meta-icon"><VideoCamera /></el-icon>
        <span class="meta-name">视频结果</span>
        <span class="meta-status" :class="`status-${status}`">{{ statusText }}</span>
      </div>
      <span v-if="dimensionText" class="meta-size">{{ dimensionText }}</span>
      <el-tag v-else-if="progress != null" size="small" effect="dark" class="meta-progress">
        {{ progress }}%
      </el-tag>
    </div>

    <!-- 媒体本体（无外壳） -->
    <div class="media-frame">
      <div v-if="effectiveVideoUrl" class="player-wrapper">
        <video
          :src="effectiveVideoUrl"
          controls
          class="video-player nodrag"
          draggable="false"
          @loadedmetadata="handleVideoMeta"
          @error="handleVideoError"
        />
        <!-- 透明拖拽层：盖住画面，底部留给原生控件 -->
        <div
          class="drag-surface drag-surface--video"
          @mousedown="onDragSurfaceMouseDown"
          @click="onDragSurfaceClick"
        />
        <transition name="fade">
          <div
            v-if="showActions"
            class="action-menu nodrag nopan"
            @click.stop
          >
            <el-tooltip content="全屏查看" placement="top" :show-after="300">
              <el-button
                class="action-icon-btn"
                type="primary"
                circle
                @click.stop="handleOpenFullscreen(effectiveVideoUrl)"
              >
                <el-icon><VideoCamera /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip content="下载视频" placement="top" :show-after="300">
              <el-button
                class="action-icon-btn"
                type="primary"
                circle
                @click.stop="downloadVideo(effectiveVideoUrl)"
              >
                <el-icon><Download /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </transition>
      </div>
      <div v-else-if="errorMessage" class="placeholder error-row">
        {{ errorMessage }}
      </div>
      <div
        v-else-if="isFailedLikeWithoutVideo"
        class="placeholder error-row"
      >
        生成失败，请重试或稍后刷新任务状态。
      </div>
      <div v-else class="placeholder">
        视频生成中或排队中…
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

    <Handle
      id="source"
      type="source"
      :position="Position.Left"
      :style="{
        background: '#555',
        width: '12px',
        height: '12px',
        border: '2px solid white',
        borderRadius: '50%',
        cursor: 'crosshair',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { Handle, Position, type NodeProps, useVueFlow } from '@vue-flow/core';
import { VideoCamera, Download } from '@element-plus/icons-vue';
import { getUploadUrl } from '@/utils/image-loader';
import { getPixverseGenerationStatus } from '@/api/pixverse';

const props = defineProps<NodeProps>();

const showActions = ref(false);
const showFullscreen = ref(false);
const fullscreenUrl = ref<string | null>(null);
const naturalSize = ref<{ w: number; h: number } | null>(null);

const { updateNodeData } = useVueFlow();

const videoUrl = computed(() => {
  const data = (props.data || {}) as any;
  const url = data.videoUrl as string | undefined;
  // 只信任明确的 videoUrl 字段，避免把 errorMessage（纯文本）误拼成 /uploads/...
  if (typeof url !== 'string') return '';
  const v = url.trim();
  if (!v) return '';
  // 允许：http(s)://...、asset://...、data:...、以及后端返回的 /uploads/... 或 uploads/...
  if (v.startsWith('http') || v.startsWith('asset://') || v.startsWith('data:')) return v;
  if (v.startsWith('/uploads/') || v.startsWith('uploads/')) return getUploadUrl(v);
  return '';
});

const retryNonce = ref(0);
const retryAttempts = ref(0);
let retryTimer: any = null;
const MAX_RETRY_ATTEMPTS = 8;

const effectiveVideoUrl = computed(() => {
  const base = videoUrl.value;
  if (!base) return '';
  const n = retryNonce.value;
  if (!n) return base;
  // cache-bust：避免命中 CDN 的 404 负缓存
  return base.includes('?') ? `${base}&_v=${n}` : `${base}?_v=${n}`;
});

const dimensionText = computed(() => {
  if (!naturalSize.value) return '';
  return `${naturalSize.value.w} × ${naturalSize.value.h}`;
});

const handleVideoMeta = (e: Event) => {
  const el = e?.target as HTMLVideoElement | null;
  if (el?.videoWidth && el?.videoHeight) {
    naturalSize.value = { w: el.videoWidth, h: el.videoHeight };
  }
};

const status = computed(() => {
  const s = (props.data as any)?.status as string | undefined;
  return s || 'pending';
});

const progress = computed(() => {
  const p = (props.data as any)?.progress as number | null | undefined;
  return typeof p === 'number' ? p : null;
});

const errorMessage = computed(() => {
  const s = status.value;
  // 生成中/排队/成功：不按 errorMessage 展示红条（上游可能带 ErrMsg=Success 等非错误文本）
  if (s !== 'failed' && s !== 'canceled') return null;
  const e = (props.data as any)?.errorMessage as string | null | undefined;
  // 如果 errorMessage 实际是一个 URL（或与 videoUrl 相同），则不当作错误展示
  if (typeof e === 'string' && (e.startsWith('http') || e.startsWith('asset://') || e.startsWith('data:') || e.startsWith('/uploads/') || e.startsWith('uploads/'))) return null;
  if (typeof e === 'string' && videoUrl.value && e === videoUrl.value) return null;
  return e ?? null;
});

/** 失败/取消且无播放地址，且没有可展示的具体错误文案时，避免误显示「排队中」占位 */
const isFailedLikeWithoutVideo = computed(() => {
  const s = status.value;
  if (s !== 'failed' && s !== 'canceled') return false;
  if (videoUrl.value) return false;
  return true;
});

const downloadVideo = (url: string) => {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = 'seedance-video.mp4';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const scheduleRetry = (delayMs: number) => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void runRetryOnce(), delayMs);
};

const runRetryOnce = async () => {
  if (retryAttempts.value >= MAX_RETRY_ATTEMPTS) return;
  retryAttempts.value += 1;
  retryNonce.value = Date.now();

  const meta = ((props.data as any)?.taskMeta || {}) as any;
  const provider = meta?.provider;
  const taskId = meta?.taskId;
  if (provider === 'pixverse' && (typeof taskId === 'number' || typeof taskId === 'string')) {
    try {
      const r = await getPixverseGenerationStatus(taskId);
      const data = (r as any)?.data?.data ?? (r as any)?.data ?? r;
      const nextVideoUrl = (data as any)?.videoUrl;
      const has = typeof nextVideoUrl === 'string' && nextVideoUrl.trim().length > 0;
      if (has) {
        updateNodeData(props.id, (old: any) => ({
          ...(old || {}),
          videoUrl: nextVideoUrl,
          status: (data as any)?.status || old?.status,
          progress: (data as any)?.progress ?? old?.progress ?? null,
          errorMessage: null,
        }));
        // 成功拿到 url：停止重试
        return;
      }
    } catch {
      // ignore and keep retrying
    }
  }

  const delay = Math.min(30000, Math.round(600 * Math.pow(1.7, retryAttempts.value - 1)));
  scheduleRetry(delay);
};

const handleVideoError = () => {
  // A+B：播放失败时，自动触发“拉取最新状态 + cache-bust”重试，避免偶发 404/负缓存
  if (!effectiveVideoUrl.value) return;
  if (retryAttempts.value >= MAX_RETRY_ATTEMPTS) return;
  // 首次错误立刻重试一次，后续指数退避
  if (retryAttempts.value === 0) scheduleRetry(0);
  else scheduleRetry(Math.min(30000, Math.round(600 * Math.pow(1.7, retryAttempts.value))));
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

// 拖拽层点击：拖动后不打开全屏；底部控件区域不被覆盖
let dragSurfaceDownPos: { x: number; y: number } | null = null;
const onDragSurfaceMouseDown = (e: MouseEvent) => {
  dragSurfaceDownPos = { x: e.clientX, y: e.clientY };
};
const onDragSurfaceClick = (e: MouseEvent) => {
  if (!effectiveVideoUrl.value) return;
  if (dragSurfaceDownPos) {
    const dx = Math.abs(e.clientX - dragSurfaceDownPos.x);
    const dy = Math.abs(e.clientY - dragSurfaceDownPos.y);
    dragSurfaceDownPos = null;
    if (dx > 5 || dy > 5) return;
  }
  handleOpenFullscreen(effectiveVideoUrl.value);
};

const statusText = computed(() => {
  switch (status.value) {
    case 'pending':
    case 'queued':
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

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
});
</script>

<style scoped>
.video-result-node {
  --media-meta-h: 32px;
  background: transparent;
  border: none;
  border-radius: 0;
  width: 320px;
  box-shadow: none;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  overflow: visible;
  position: relative;
}

.video-result-node :deep(.vue-flow__handle) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  top: calc(var(--media-meta-h) + (100% - var(--media-meta-h)) / 2) !important;
}

.video-result-node:hover :deep(.vue-flow__handle) {
  opacity: 1;
  pointer-events: auto;
}

.media-meta {
  height: 26px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  color: #c8c8c8;
  font-size: 12px;
  line-height: 1.2;
  user-select: none;
  cursor: grab;
}

.media-meta:active {
  cursor: grabbing;
}

.meta-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.meta-icon {
  font-size: 14px;
  color: #a8a8a8;
  flex-shrink: 0;
}

.meta-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: #e0e0e0;
}

.meta-status {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.9;
}

.meta-size {
  flex-shrink: 0;
  color: #9a9a9a;
  font-variant-numeric: tabular-nums;
}

.meta-progress {
  flex-shrink: 0;
  pointer-events: none;
}

.status-pending,
.status-queued,
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

.media-frame {
  position: relative;
  border-radius: 5px;
  overflow: hidden;
  background: #1a1a1a;
  cursor: grab;
}

.media-frame:active {
  cursor: grabbing;
}

.player-wrapper {
  position: relative;
  display: block;
  min-height: 40px;
}

.drag-surface {
  position: absolute;
  inset: 0;
  z-index: 2;
  cursor: grab;
  background: transparent;
}

.drag-surface:active {
  cursor: grabbing;
}

/* 底部留给 video controls，避免挡住进度条/音量 */
.drag-surface--video {
  bottom: 44px;
}

.action-menu {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: center;
  background: rgba(0, 0, 0, 0.45);
  padding: 5px 8px;
  border-radius: 999px;
  box-shadow: none;
  z-index: 20;
  cursor: default;
}

.action-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-menu :deep(.el-button) {
  border: none;
  box-shadow: none;
  background-color: rgba(0, 0, 0, 0.55);
}

.action-menu :deep(.el-button:hover),
.action-menu :deep(.el-button:focus),
.action-menu :deep(.el-button:active) {
  border: none;
  box-shadow: none;
  background-color: rgba(0, 0, 0, 0.75);
}

.video-player {
  width: 100%;
  display: block;
  border-radius: 5px;
  background: #000;
  max-height: 360px;
  -webkit-user-drag: none;
  user-select: none;
}

.placeholder {
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-size: 12px;
  color: #999;
  text-align: center;
  border-radius: 5px;
  background: #25262b;
}

.error-row {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.12);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 全屏视频预览样式（与 VideoNode 保持一致） */
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
}

.fullscreen-video {
  max-width: 95vw !important;
  max-height: 95vh !important;
  object-fit: contain !important;
}
</style>
