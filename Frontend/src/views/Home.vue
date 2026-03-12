<template>
  <div class="home-container">
    <!-- 左侧导航栏 -->
    <Sidebar @open-teaching="openTeachingDialog" />
    
    <!-- 主内容区域 -->
    <div class="main-content">
      <!-- 顶部用户信息 -->
      <div class="header-section">
        <div class="header-spacer" />
        <div class="header-right">
          <div class="user-info">
            <el-avatar :size="32" class="user-avatar">
              {{ userStore.userInfo.username?.charAt(0).toUpperCase() || 'U' }}
            </el-avatar>
            <div class="user-details">
              <span class="username">{{ userStore.userInfo.username || '用户' }}</span>
              <span class="user-role">
                {{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }}
                <template v-if="userStore.userInfo.role !== 1">
                  · 可用积分 {{ userStore.userInfo.credits ?? 0 }}
                </template>
              </span>
            </div>
            <el-button
              v-if="userStore.userInfo.role !== 1"
              text
              type="primary"
              size="small"
              @click="showApplyCreditsModal = true"
            >
              申请积分
            </el-button>
            <el-button text type="danger" size="small" @click="handleLogout">
              退出
            </el-button>
          </div>
        </div>
      </div>

      <!-- 同一板块：Logo + 主副标题 + 输入框 -->
      <div class="hero-section">
        <div class="hero-brand">
          <div class="brand-row">
            <img src="/logo.svg" alt="Logo" class="brand-logo" />
            <h1 class="main-title">ART<sup class="small-text">N</sup>.AI</h1>
          </div>
        </div>
        <div class="hero-input">
          <QuickStartInput />
        </div>
      </div>
      
      <!-- 最近项目区域 -->
      <div class="recent-projects-section">
        <RecentProjects ref="recentProjectsRef" />
      </div>
      
      <!-- 灵感发现区域 -->
      <div class="inspiration-section">
        <InspirationGrid />
      </div>
    </div>

    <!-- 申请积分弹窗 -->
    <el-dialog v-model="showApplyCreditsModal" title="申请积分" width="400px">
      <el-form :model="applyCreditsForm" label-width="80px">
        <el-form-item label="申请数量">
          <el-input-number v-model="applyCreditsForm.amount" :min="1" :max="10000" />
        </el-form-item>
        <el-form-item label="申请原因">
          <el-input v-model="applyCreditsForm.reason" type="textarea" :rows="3" placeholder="请输入申请原因（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showApplyCreditsModal = false">取消</el-button>
        <el-button type="primary" :loading="applyCreditsLoading" @click="handleApplyCredits">提交</el-button>
      </template>
    </el-dialog>

    <!-- 教学视频弹窗：优先 MP4（浏览器对音轨支持更好），无则用 MOV -->
    <el-dialog
      v-model="showTeachingDialog"
      title="使用引导"
      width="70%"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      append-to-body
    >
      <div class="teaching-video-wrapper">
        <video
          ref="teachingVideoRef"
          controls
          autoplay
          playsinline
          class="teaching-video"
          :src="teachingVideoSrc"
          @loadedmetadata="onTeachingVideoLoaded"
        >
          您的浏览器不支持视频播放，请使用 Chrome 或 Safari。
        </video>
      </div>
      <p v-if="showNoSoundHint" class="teaching-hint">若没有声音，请将视频转为 MP4（H.264+AAC）后保存为 public/teaching.mp4</p>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../store/user';
import { applyCredits } from '@/api/user';
import { ElMessage } from 'element-plus';
import Sidebar from '@/components/Sidebar.vue';
import QuickStartInput from '@/components/QuickStartInput.vue';
import RecentProjects from '@/components/RecentProjects.vue';
import InspirationGrid from '@/components/InspirationGrid.vue';

const router = useRouter();
const userStore = useUserStore();

const showTeachingDialog = ref(false);
const teachingVideoRef = ref<HTMLVideoElement | null>(null);
const showNoSoundHint = ref(false);

// 教学视频使用与图片相同的公共 COS 域名
const teachingVideoSrc = computed(() => {
  const base = import.meta.env.VITE_UPLOAD_BASE_URL || window.location.origin;
  return `${base}/assets/teaching.mp4`;
});

const onTeachingVideoLoaded = () => {
  const el = teachingVideoRef.value;
  if (el?.currentSrc) showNoSoundHint.value = el.currentSrc.includes('.mov');
};

onMounted(() => {
  userStore.fetchCredits();
  if (typeof window !== 'undefined') {
    const seen = localStorage.getItem('hasSeenTeachingVideo');
    if (!seen) {
      showTeachingDialog.value = true;
      localStorage.setItem('hasSeenTeachingVideo', '1');
    }
  }
});
const recentProjectsRef = ref<InstanceType<typeof RecentProjects> | null>(null);

const handleLogout = async () => {
  await userStore.logout();
  router.push('/login');
};

const openTeachingDialog = () => {
  showNoSoundHint.value = false;
  showTeachingDialog.value = true;
};

const pauseTeachingVideo = () => {
  const el = teachingVideoRef.value;
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
};

watch(showTeachingDialog, (val) => {
  if (!val) pauseTeachingVideo();
});

const showApplyCreditsModal = ref(false);
const applyCreditsForm = reactive({ amount: 10, reason: '' });
const applyCreditsLoading = ref(false);

const handleApplyCredits = async () => {
  applyCreditsLoading.value = true;
  try {
    await applyCredits(applyCreditsForm.amount, applyCreditsForm.reason);
    ElMessage.success('申请已提交，请等待管理员审核');
    showApplyCreditsModal.value = false;
    applyCreditsForm.amount = 10;
    applyCreditsForm.reason = '';
  } catch {
    // error handled by request interceptor
  } finally {
    applyCreditsLoading.value = false;
  }
};
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  padding-left: 80px;
}

.main-content {
  flex: 1;
  padding: 24px 32px;
  /* max-width: 1400px; */
  margin: 0 auto;
  width: 100%;
}

/* 顶部仅用户信息 */
.header-section {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 8px;
  padding: 12px 0 0;
}

.header-spacer {
  flex: 1;
}

/* 同一板块：Logo + 文案 + 输入框 */
.hero-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 24px 0 32px;
  margin-bottom: 24px;
}

.hero-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.hero-input {
  width: 100%;
  max-width: 720px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  width: 48px;
  height: 48px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}

.main-title {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
  margin: 0;
}

.small-text {
  font-size: 12px;
  margin: 0 0 4px 4px;
}

.sub-title {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
}

.teaching-video-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
}

.teaching-video {
  width: 100%;
  max-height: 70vh;
  border-radius: 8px;
  background: #000;
}

.teaching-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: #909399;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #fff;
  border-radius: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.user-avatar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  font-weight: 600;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.username {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.user-role {
  font-size: 12px;
  color: #909399;
}

/* 最近项目区域 */
.recent-projects-section {
  margin-bottom: 48px;
  max-width: 1400px;
  margin: 0 auto;
}

/* 灵感发现区域 */
.inspiration-section {
  margin-bottom: 48px;
  max-width: 1400px;
  margin: 0 auto;
}

@media (max-width: 1024px) {
  .home-container {
    padding-left: 60px;
  }
  
  .main-content {
    padding: 20px 24px;
  }

  .header-section {
    flex-direction: column;
    gap: 16px;
    align-items: center;
  }

  .hero-section {
    padding: 16px 0 24px;
  }

  .main-title {
    font-size: 22px;
  }
}

@media (max-width: 768px) {
  .home-container {
    padding-left: 0;
}

  .main-content {
    padding: 16px;
}

  .header-section {
    margin-bottom: 24px;
  }

  .brand-logo {
    width: 40px;
    height: 40px;
  }

  .main-title {
    font-size: 20px;
  }
  
  .user-info {
    padding: 6px 12px;
}

  .user-details {
    display: none;
  }
}
</style>
