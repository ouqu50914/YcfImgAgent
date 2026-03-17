<template>
  <div
    class="video-result-node"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <div class="node-header">
      <el-icon><VideoCamera /></el-icon>
      <span>视频结果</span>
    </div>
    <div class="node-content">
      <div class="status-row">
        <span class="status-label">状态</span>
        <span class="status-value" :class="`status-${status}`">
          {{ statusText }}
        </span>
        <el-tag v-if="progress != null" size="small" effect="dark">
          {{ progress }}%
        </el-tag>
      </div>

      <div v-if="videoUrl" class="player-wrapper">
        <video
          :src="videoUrl"
          controls
          class="video-player"
        />
        <transition name="fade">
          <div
            v-if="showActions"
            class="action-menu"
          >
            <el-tooltip content="下载视频" placement="top" :show-after="300">
              <el-button
                class="action-icon-btn"
                type="primary"
                circle
                @click.stop="downloadVideo(videoUrl)"
              >
                <el-icon><Download /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </transition>
      </div>
      <div v-if="errorMessage" class="error-row">
        {{ errorMessage }}
      </div>
      <div v-else-if="!videoUrl" class="placeholder">
        视频生成中或排队中…
      </div>
    </div>

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
        top: '50%'
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { VideoCamera, Download } from '@element-plus/icons-vue';

const props = defineProps<NodeProps>();

const showActions = ref(false);

const videoUrl = computed(() => {
  const data = (props.data || {}) as any;
  const url = data.videoUrl as string | undefined;
  const err = data.errorMessage as string | undefined;
  // 优先使用正常的 videoUrl；没有时尝试从 errorMessage 中兜底
  const candidate = url || err;

  if (typeof candidate === 'string' && candidate.startsWith('http')) {
    return candidate;
  }
  return '';
});

const status = computed(() => {
  const s = (props.data as any)?.status as string | undefined;
  return s || 'pending';
});

const progress = computed(() => {
  const p = (props.data as any)?.progress as number | null | undefined;
  return typeof p === 'number' ? p : null;
});

const errorMessage = computed(() => {
  const e = (props.data as any)?.errorMessage as string | null | undefined;
  return e ?? null;
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
</script>

<style scoped>
.video-result-node {
  background: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 20px;
  width: 320px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
}

.video-result-node :deep(.vue-flow__handle) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.video-result-node:hover :deep(.vue-flow__handle) {
  opacity: 1;
  pointer-events: auto;
}

.node-header {
  background: #3a3a3f;
  border-bottom: 1px solid #404040;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #e0e0e0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-content {
  padding: 10px 12px 12px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.error-row {
  font-size: 12px;
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.1);
  border-radius: 6px;
  padding: 4px 6px;
}

.player-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.action-menu {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: center;
  z-index: 10;
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
  border-radius: 10px;
  background: #000;
  max-height: 220px;
}

.placeholder {
  font-size: 12px;
  color: #999;
}
</style>

