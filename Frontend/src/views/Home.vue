<template>
  <div class="home-container">
    <!-- 左侧导航栏 -->
    <Sidebar />
    
    <!-- 主内容区域 -->
    <div class="main-content">
      <!-- 顶部Header -->
    <div class="header-section">
      <div class="header-left">
          <div class="logo-section">
            <h1 class="brand-title">AI生图工具</h1>
          </div>
          <div class="title-section">
            <h2 class="main-title">让AI生图更简单</h2>
            <p class="sub-title">智能工作流，帮你搞定一切</p>
      </div>
        </div>
        <div class="header-right">
          <div class="user-info">
            <el-avatar :size="32" class="user-avatar">
              {{ userStore.userInfo.username?.charAt(0).toUpperCase() || 'U' }}
            </el-avatar>
            <div class="user-details">
              <span class="username">{{ userStore.userInfo.username || '用户' }}</span>
              <span class="user-role">
                {{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }}
              </span>
      </div>
            <el-button text type="danger" size="small" @click="handleLogout">
              退出
      </el-button>
        </div>
      </div>
    </div>

      <!-- 中央快速启动输入框 -->
      <div class="quick-start-section">
        <QuickStartInput />
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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../store/user';
import Sidebar from '@/components/Sidebar.vue';
import QuickStartInput from '@/components/QuickStartInput.vue';
import RecentProjects from '@/components/RecentProjects.vue';
import InspirationGrid from '@/components/InspirationGrid.vue';

const router = useRouter();
const userStore = useUserStore();
const recentProjectsRef = ref<InstanceType<typeof RecentProjects> | null>(null);

const handleLogout = async () => {
  await userStore.logout();
  router.push('/login');
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
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

/* 顶部Header区域 */
.header-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 40px;
  padding: 20px 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.logo-section {
  display: flex;
  align-items: center;
}

.brand-title {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
  margin: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.title-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.main-title {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  margin: 0;
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

/* 快速启动区域 */
.quick-start-section {
  margin-bottom: 48px;
}

/* 最近项目区域 */
.recent-projects-section {
  margin-bottom: 48px;
}

/* 灵感发现区域 */
.inspiration-section {
  margin-bottom: 48px;
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
    align-items: flex-start;
  }
  
  .header-left {
  flex-direction: column;
    align-items: flex-start;
    gap: 12px;
}

  .main-title {
    font-size: 24px;
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
  
  .brand-title {
    font-size: 20px;
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
