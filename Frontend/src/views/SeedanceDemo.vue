<template>
  <div class="seedance-page">
    <h2 class="title">Seedance 文生视频 Demo</h2>

    <el-form :model="form" label-width="100px" class="form">
      <el-form-item label="提示词">
        <el-input
          v-model="form.prompt"
          type="textarea"
          :rows="4"
          placeholder="请输入视频描述，例如：微距镜头对准树上鲜艳的花瓣，逐渐放大。"
        />
      </el-form-item>
      <el-form-item label="宽高比">
        <el-select v-model="form.ratio" placeholder="自动适配">
          <el-option label="自动（adaptive）" value="adaptive" />
          <el-option label="16:9" value="16:9" />
          <el-option label="9:16" value="9:16" />
          <el-option label="1:1" value="1:1" />
          <el-option label="4:3" value="4:3" />
          <el-option label="3:4" value="3:4" />
          <el-option label="21:9" value="21:9" />
        </el-select>
      </el-form-item>
      <el-form-item label="时长（秒）">
        <el-input-number
          v-model="form.duration"
          :min="4"
          :max="15"
          :step="1"
        />
        <el-checkbox v-model="useAutoDuration" class="ml-12">自动（模型决定）</el-checkbox>
      </el-form-item>
      <el-form-item label="音频">
        <el-switch v-model="form.generateAudio" active-text="生成音频" inactive-text="无声视频" />
      </el-form-item>
      <el-form-item label="联网搜索">
        <el-switch v-model="form.enableWebSearch" active-text="开启" inactive-text="关闭" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="creating" @click="handleCreate">
          创建视频任务
        </el-button>
      </el-form-item>
    </el-form>

    <div v-if="taskId" class="result-section">
      <h3 class="subtitle">任务状态</h3>
      <p>任务 ID：{{ taskId }}</p>
      <p>状态：{{ statusText }}</p>
      <p v-if="progressText">进度：{{ progressText }}</p>
      <p v-if="errorMessage" class="error-text">错误：{{ errorMessage }}</p>

      <el-button
        type="primary"
        :loading="polling"
        @click="fetchStatus"
      >
        手动刷新状态
      </el-button>
      <el-button
        v-if="videoUrl"
        type="success"
        @click="openVideoInNewTab"
      >
        在新窗口打开视频
      </el-button>

      <div v-if="videoUrl" class="video-wrapper">
        <video
          :src="videoUrl"
          controls
          playsinline
          class="video-player"
        >
          您的浏览器不支持视频播放。
        </video>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { createSeedanceGeneration, getSeedanceGenerationStatus } from '@/api/seedance';

const form = ref({
  prompt: '',
  ratio: 'adaptive',
  duration: 5,
  generateAudio: true,
  enableWebSearch: false,
});

const useAutoDuration = ref(false);

const creating = ref(false);
const polling = ref(false);
const taskId = ref<string | null>(null);
const status = ref<string>('');
const progress = ref<string | number | null>(null);
const videoUrl = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

let timer: number | null = null;

const statusText = computed(() => status.value || '未知');
const progressText = computed(() => {
  if (progress.value === null || progress.value === undefined || progress.value === '') return '';
  return String(progress.value);
});

const clearTimer = () => {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
};

const startPolling = () => {
  clearTimer();
  timer = window.setInterval(() => {
    if (taskId.value) {
      fetchStatus();
    }
  }, 8000);
};

const handleCreate = async () => {
  if (!form.value.prompt.trim()) {
    ElMessage.warning('请先输入提示词');
    return;
  }
  creating.value = true;
  errorMessage.value = null;
  videoUrl.value = null;
  status.value = '';
  progress.value = null;
  clearTimer();
  try {
    const payload: any = {
      prompt: form.value.prompt,
      ratio: form.value.ratio,
      generateAudio: form.value.generateAudio,
      enableWebSearch: form.value.enableWebSearch,
    };
    if (!useAutoDuration.value) {
      payload.duration = form.value.duration;
    } else {
      payload.duration = -1;
    }
    const res = await createSeedanceGeneration(payload);
    const data = res.data.data;
    taskId.value = data.task_id || data.id;
    status.value = data.status || '';
    progress.value = data.progress ?? null;
    ElMessage.success('任务创建成功，开始轮询状态');
    startPolling();
  } catch (e) {
    // 具体错误由拦截器处理
  } finally {
    creating.value = false;
  }
};

const fetchStatus = async () => {
  if (!taskId.value) return;
  polling.value = true;
  try {
    const res = await getSeedanceGenerationStatus(taskId.value);
    const data = res.data.data;
    status.value = data.status;
    progress.value = data.progress ?? null;
    errorMessage.value = data.errorMessage ?? null;
    if (data.videoUrl) {
      videoUrl.value = data.videoUrl;
    }
    if (status.value === 'succeeded' || status.value === 'failed' || status.value === 'canceled') {
      clearTimer();
    }
  } catch (e) {
    // 错误由拦截器处理
  } finally {
    polling.value = false;
  }
};

const openVideoInNewTab = () => {
  if (videoUrl.value) {
    window.open(videoUrl.value, '_blank');
  }
};

onUnmounted(() => {
  clearTimer();
});
</script>

<style scoped>
.seedance-page {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
}

.subtitle {
  font-size: 16px;
  font-weight: 500;
  margin: 24px 0 8px;
}

.form {
  background: #252525;
  padding: 16px 20px 4px;
  border-radius: 12px;
  color: #b0b0b0;
}

.form :deep(.el-input__wrapper),
.form :deep(.el-textarea__inner),
.form :deep(.el-select__wrapper),
.form :deep(.el-input-number__decrease),
.form :deep(.el-input-number__increase) {
  background-color: #252525;
  border-color: #404040;
  box-shadow: none;
  color: #b0b0b0;
}

.form :deep(.el-input__inner),
.form :deep(.el-input-number__input) {
  color: #b0b0b0;
}

.form :deep(.el-input__inner::placeholder),
.form :deep(.el-textarea__inner::placeholder) {
  color: #808080;
}

.result-section {
  margin-top: 24px;
}

.video-wrapper {
  margin-top: 16px;
}

.video-player {
  width: 100%;
  max-height: 480px;
  border-radius: 8px;
  background: #000;
}

.ml-12 {
  margin-left: 12px;
}

.error-text {
  color: #f56c6c;
  margin-top: 4px;
}
</style>

