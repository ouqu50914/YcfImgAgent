<template>
  <div class="video-ref-node">
    <div class="node-header">
      <el-icon><VideoCamera /></el-icon>
      <span>视频参考 · {{ alias || '未命名' }}</span>
    </div>
    <div class="node-content">
      <div class="param-item">
        <div class="param-label">视频</div>
        <el-button size="small" @click="handleSelectFile" :loading="uploading">
          {{ uploading ? '上传中…' : (url ? '重新上传' : '上传视频') }}
        </el-button>
      </div>
      <el-input
        v-model="url"
        size="small"
        class="url-input"
        placeholder="也可手动填写一个视频 URL"
      />
      <div class="preview-wrapper">
        <video
          v-if="normalizedUrl"
          :src="normalizedUrl"
          controls
          class="video-preview"
          @click.stop="handleVideoClick($event, normalizedUrl)"
        />
        <div v-else class="placeholder">
          暂无预览
        </div>
      </div>
    </div>

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
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch, onMounted } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { VideoCamera } from '@element-plus/icons-vue';
import { getUploadUrl } from '@/utils/image-loader';
import { uploadVideo } from '@/api/upload';
import { ElMessage } from 'element-plus';

const props = defineProps<NodeProps>();

type MediaAliasStore = {
  getOrCreateVideoAlias: (key: string) => string;
  getOrCreateAudioAlias: (key: string) => string;
};

const mediaAliasStore = inject<MediaAliasStore | null>('mediaAliasStore', null);

const url = ref<string>((props.data as any)?.url || '');
const alias = ref<string>((props.data as any)?.resourceAlias || '');
const uploading = ref(false);
const showFullscreen = ref(false);
const fullscreenUrl = ref<string | null>(null);

const normalizedUrl = computed(() => {
  const v = url.value.trim();
  if (!v) return '';
  if (v.startsWith('http')) return v;
  return getUploadUrl(v);
});

watch(
  url,
  (val) => {
    if (!props.data) {
      (props as any).data = {};
    }
    (props.data as any).url = val.trim();
  },
  { immediate: true }
);

// 初始化或恢复别名：按工作流范围自动生成“视频1、视频2...”
const ensureAlias = () => {
  const key = props.id;
  if (!key || !mediaAliasStore) return;
  const current = alias.value && alias.value.trim();
  const next = current || mediaAliasStore.getOrCreateVideoAlias(key);
  alias.value = next;
  if (!props.data) {
    (props as any).data = {};
  }
  (props.data as any).resourceAlias = next;
};

onMounted(() => {
  ensureAlias();
});

const handleSelectFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    uploading.value = true;
    try {
      const res: any = await uploadVideo(file);
      const originalUrl: string | undefined = res?.data?.url;
      if (!originalUrl) {
        ElMessage.error('视频上传失败：返回数据异常');
        return;
      }
      url.value = originalUrl;
      ElMessage.success('视频上传成功');
    } catch (e: any) {
      console.error('[VideoRefNode] 视频上传失败', e);
      if (!(e as any)?.response) {
        ElMessage.error('视频上传失败，请稍后重试');
      }
    } finally {
      uploading.value = false;
    }
  };

  input.click();
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
  const controlHeight = 48;
  if (event.clientY < rect.bottom - controlHeight) {
    event.preventDefault();
    event.stopPropagation();
    try {
      target.pause();
    } catch {}
    handleOpenFullscreen(url);
  }
};
</script>

<style scoped>
.video-ref-node {
  background: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 20px;
  width: 260px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
}

.video-ref-node :deep(.vue-flow__handle) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.video-ref-node:hover :deep(.vue-flow__handle) {
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
  color: #b0b0b0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.param-label {
  font-size: 12px;
  color: #b0b0b0;
}

.url-input {
  margin-top: 2px;
}

.preview-wrapper {
  margin-top: 8px;
}

.video-preview {
  width: 100%;
  border-radius: 8px;
  background: #000;
  max-height: 200px;
}

.placeholder {
  font-size: 12px;
  color: #808080;
}

/* 全屏视频预览样式（与其他视频节点保持一致） */
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

:deep(.fullscreen-video-overlay) {
  position: fixed !important;
  inset: 0 !important;
  overflow: hidden !important;
}

/* 表单控件深色样式 */
.video-ref-node :deep(.el-input__wrapper) {
  background-color: #252525;
  border-color: #404040;
  box-shadow: none;
}

.video-ref-node :deep(.el-input__inner) {
  color: #b0b0b0;
}

.video-ref-node :deep(.el-input__inner::placeholder) {
  color: #808080;
}
</style>

