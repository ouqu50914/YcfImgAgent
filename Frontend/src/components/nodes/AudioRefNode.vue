<template>
  <div class="audio-ref-node">
    <div class="node-header">
      <el-icon><Headset /></el-icon>
      <span>音频参考 · {{ alias || '未命名' }}</span>
    </div>
    <div class="node-content">
      <div class="param-item">
        <div class="param-label">音频</div>
        <el-button size="small" @click="handleSelectFile" :loading="uploading">
          {{ uploading ? '上传中…' : (url ? '重新上传' : '上传音频') }}
        </el-button>
      </div>
      <el-input
        v-model="url"
        size="small"
        class="url-input"
        placeholder="也可手动填写一个音频 URL"
      />
      <div class="preview-wrapper">
        <audio
          v-if="normalizedUrl"
          :src="normalizedUrl"
          controls
          class="audio-preview"
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
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { Headset } from '@element-plus/icons-vue';
import { getUploadUrl } from '@/utils/image-loader';
import { uploadAudio } from '@/api/upload';
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

// 初始化或恢复别名：按工作流范围自动生成“音频1、音频2...”
const ensureAlias = () => {
  const key = props.id;
  if (!key || !mediaAliasStore) return;
  const current = alias.value && alias.value.trim();
  const next = current || mediaAliasStore.getOrCreateAudioAlias(key);
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
  input.accept = 'audio/*';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    uploading.value = true;
    try {
      const res: any = await uploadAudio(file);
      const originalUrl: string | undefined = res?.data?.url;
      if (!originalUrl) {
        ElMessage.error('音频上传失败：返回数据异常');
        return;
      }
      url.value = originalUrl;
      ElMessage.success('音频上传成功');
    } catch (e: any) {
      console.error('[AudioRefNode] 音频上传失败', e);
      if (!(e as any)?.response) {
        ElMessage.error('音频上传失败，请稍后重试');
      }
    } finally {
      uploading.value = false;
    }
  };

  input.click();
};
</script>

<style scoped>
.audio-ref-node {
  background: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 20px;
  width: 260px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
}

.audio-ref-node :deep(.vue-flow__handle) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.audio-ref-node:hover :deep(.vue-flow__handle) {
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

.audio-preview {
  width: 100%;
}

.placeholder {
  font-size: 12px;
  color: #808080;
}

/* 表单控件深色样式 */
.audio-ref-node :deep(.el-input__wrapper) {
  background-color: #252525;
  border-color: #404040;
  box-shadow: none;
}

.audio-ref-node :deep(.el-input__inner) {
  color: #b0b0b0;
}

.audio-ref-node :deep(.el-input__inner::placeholder) {
  color: #808080;
}
</style>

