<template>
  <div class="home-container">
    <!-- 顶部区域 -->
    <div class="header-section">
      <div class="header-left">
        <h1 class="page-title">工作台</h1>
      </div>
      <div class="header-right">
        <div class="login-info">
          <span class="login-text">
            {{ userStore.userInfo.username || '用户' }} 
            ({{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }})
          </span>
          <el-button text type="danger" size="small" @click="handleLogout">退出</el-button>
        </div>
      </div>
    </div>

    <!-- 主要导航按钮 -->
    <div class="nav-buttons">
      <el-button 
        type="primary" 
        size="large"
        @click="router.push('/workflow')"
      >
        工作流编辑器
      </el-button>
      <el-button 
        size="large"
        @click="router.push('/profile')"
      >
        个人中心
      </el-button>
      <el-button 
        v-if="userStore.userInfo.role === 1"
        type="warning" 
        size="large"
        @click="router.push('/admin')"
      >
        管理后台
      </el-button>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <div class="content-wrapper">
        <div class="center-action">
          <div class="action-text" @click="router.push('/workflow')">进入工作流编辑器</div>
          <div class="action-line"></div>
        </div>
      </div>
    </div>

    <!-- 底部：历史工作流 -->
    <div class="workflow-section">
      <div class="section-header">
        <div class="section-title">历史工作流</div>
        <el-button 
          type="danger" 
          size="small"
          @click="router.push('/workflow-plaza')"
        >
          前往工作流广场
        </el-button>
      </div>
      <!-- 有工作流时显示网格 -->
      <div v-if="workflows.length > 0" class="workflow-grid">
        <div 
          v-for="(workflow, index) in workflows" 
          :key="index"
          class="workflow-card"
          @click="handleWorkflowClick(workflow)"
        >
          <div class="workflow-preview">
            <img 
              v-if="workflow.preview" 
              :src="getImageUrl(workflow.preview)" 
              alt="工作流预览"
              @error="handleImageError"
            />
            <div v-else class="workflow-placeholder">暂无预览</div>
          </div>
          <div class="workflow-name">{{ workflow.name || '未命名工作流' }}</div>
        </div>
      </div>
      <!-- 没有工作流时显示按钮 -->
      <div v-else class="no-workflow-container">
        <el-button 
          type="primary" 
          size="large"
          @click="router.push('/workflow')"
          class="enter-workflow-btn"
        >
          进入工作流编辑器
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useUserStore } from '../store/user';
import { useRouter } from 'vue-router';
import { getTemplates, type WorkflowTemplate } from '@/api/workflow';

const userStore = useUserStore();
const router = useRouter();
const workflows = ref<Array<{ id?: number; name?: string; preview?: string }>>([]);

const handleLogout = async () => {
  await userStore.logout();
  router.push('/login');
};

const handleWorkflowClick = (workflow: any) => {
  if (workflow.id) {
    // 可以跳转到工作流详情或直接加载
    router.push(`/workflow?id=${workflow.id}`);
  }
};

// 获取完整图片URL
const getImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) {
    return `${window.location.origin}${url}`;
  }
  return `${window.location.origin}/uploads/${url}`;
};

// 图片加载错误处理
const handleImageError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) {
    target.style.display = 'none';
    const placeholder = target.nextElementSibling || target.parentElement?.querySelector('.workflow-placeholder');
    if (placeholder) {
      (placeholder as HTMLElement).style.display = 'flex';
    }
  }
};

// 加载工作流列表
const loadWorkflows = async () => {
  try {
    const res: any = await getTemplates();
    if (res.data && Array.isArray(res.data)) {
      // 只显示前4个，或者公开的工作流
      workflows.value = res.data.slice(0, 4).map((item: WorkflowTemplate) => {
        // 优先使用封面图片，如果没有则从工作流数据中提取第一张图片作为预览
        let preview: string | undefined = undefined;
        
        // 优先使用保存的封面图片
        if (item.cover_image) {
          preview = item.cover_image;
        } else if (item.workflow_data && typeof item.workflow_data === 'object') {
          // 如果没有封面图片，查找第一个图片节点的图片URL
          const nodes = item.workflow_data.nodes || [];
          const imageNode = nodes.find((node: any) => 
            node.type === 'image' && (node.data?.imageUrl || node.data?.image_url)
          );
          if (imageNode) {
            preview = imageNode.data?.imageUrl || imageNode.data?.image_url;
          }
        }
        
        return {
          id: item.id,
          name: item.name,
          preview
        };
      });
    }
  } catch (error) {
    console.error('加载工作流失败:', error);
  }
};

onMounted(() => {
  loadWorkflows();
});
</script>

<style scoped>
.home-container {
  height: 100vh;
  width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f5f5;
  padding: 20px;
  box-sizing: border-box;
}

/* 顶部区域 */
.header-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-left {
  flex: 1;
}

.page-title {
  font-size: 32px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.welcome-text {
  font-size: 16px;
  color: #606266;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
}

.login-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  font-size: 14px;
}

.login-text {
  color: #909399;
}

/* 导航按钮 */
.nav-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.nav-buttons .el-button {
  flex: 1;
  max-width: 200px;
}


/* 主要内容区域 */
.main-content {
  margin-bottom: 40px;
}

.content-wrapper {
  background: white;
  border: 2px solid #f56c6c;
  border-radius: 8px;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
}

.content-wrapper:hover {
  border-color: #f78989;
  box-shadow: 0 4px 12px rgba(245, 108, 108, 0.2);
}

.center-action {
  text-align: center;
}

.action-text {
  font-size: 24px;
  font-weight: 600;
  color: #f56c6c;
  margin-bottom: 12px;
  cursor: pointer;
}

.action-line {
  width: 60px;
  height: 2px;
  background: #f56c6c;
  margin: 0 auto;
}

/* 底部工作流区域 */
.workflow-section {
  background: white;
  border-radius: 8px;
  padding: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.workflow-card {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
}

.workflow-card:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.15);
  transform: translateY(-2px);
}

.workflow-card.placeholder {
  cursor: default;
  opacity: 0.5;
}

.workflow-card.placeholder:hover {
  transform: none;
  border-color: #e0e0e0;
  box-shadow: none;
}

.workflow-preview {
  width: 100%;
  height: 0;
  padding-bottom: 75%; /* 4:3 比例，更合理的高度 */
  position: relative;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.workflow-preview img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.workflow-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 14px;
}

.workflow-name {
  padding: 12px;
  font-size: 14px;
  color: #303133;
  text-align: center;
  font-weight: 500;
}

/* 无工作流时的按钮容器 */
.no-workflow-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60px 20px;
}

.enter-workflow-btn {
  padding: 16px 48px;
  font-size: 16px;
  font-weight: 500;
}
</style>
