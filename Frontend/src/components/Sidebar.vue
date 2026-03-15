<template>
  <div class="sidebar-container">
    <div class="sidebar-nav">
      <el-tooltip content="新建工作流" placement="right">
        <div 
          class="nav-item"
          :class="{ active: currentRoute === '/workflow' && !routeQuery }"
          @click="handleNavClick('/workflow')"
        >
          <el-icon :size="24"><Plus /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip content="首页" placement="right">
        <div 
          class="nav-item"
          :class="{ active: currentRoute === '/' }"
          @click="handleNavClick('/')"
        >
          <el-icon :size="24"><House /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip content="我的工作流" placement="right">
        <div 
          class="nav-item"
          :class="{ active: currentRoute === '/workflow-plaza' && !isPublic }"
          @click="handleNavClick('/workflow-plaza')"
        >
          <el-icon :size="24"><Folder /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip content="模板库" placement="right">
        <div 
          class="nav-item"
          :class="{ active: currentRoute === '/workflow-plaza' && isPublic }"
          @click="handleNavClick('/workflow-plaza', { public: true })"
        >
          <el-icon :size="24"><Collection /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip content="设计稿检查工具" placement="right">
        <div 
          class="nav-item"
          @click="openDesignChecker"
        >
          <el-icon :size="24"><Document /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip content="操作手册" placement="right">
        <div 
          class="nav-item"
          @click="openHelpDoc"
        >
          <el-icon :size="24"><QuestionFilled /></el-icon>
        </div>
      </el-tooltip>

      <el-tooltip v-if="isAdmin" content="管理中心" placement="right">
        <div 
          class="nav-item"
          :class="{ active: currentRoute === '/admin' }"
          @click="handleNavClick('/admin')"
        >
          <el-icon :size="24"><Setting /></el-icon>
        </div>
      </el-tooltip>

      <div class="sidebar-spacer" />

      <el-tooltip content="新手引导" placement="right">
        <div class="nav-item nav-item-guide" @click="$emit('open-teaching')">
          <el-icon :size="24"><VideoPlay /></el-icon>
        </div>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

defineEmits<{ 'open-teaching': [] }>();
import { useRouter, useRoute } from 'vue-router';
import { Plus, House, Folder, Document, Collection, QuestionFilled, Setting, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import { getHelpDocUrlForClient } from '@/api/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const helpDocUrl = ref<string | null>(null);

const currentRoute = computed(() => route.path);
const routeQuery = computed(() => route.query.id);
const isPublic = computed(() => route.query.public === 'true');
const isAdmin = computed(() => {
  const role = userStore.userInfo.role || userStore.userInfo.role_id;
  return role === 1;
});

const handleNavClick = (path: string, query?: any) => {
  if (query) {
    router.push({ path, query });
  } else {
    router.push(path);
  }
};

const openHelpDoc = () => {
  if (helpDocUrl.value) {
    window.open(helpDocUrl.value, '_blank');
  } else {
    ElMessage.warning('暂未配置操作手册链接');
  }
};

const openDesignChecker = () => {
  // 使用与图片相同的 COS 公共域名，指向 COS 上的 www/DesignChecker.html
  const base = import.meta.env.VITE_UPLOAD_BASE_URL || (import.meta.env.BASE_URL || '/');
  const url = `${base}/www/DesignChecker.html`;
  window.open(url, '_blank');
};

onMounted(async () => {
  try {
    const res = (await getHelpDocUrlForClient()) as unknown as { url: string | null };
    helpDocUrl.value = res.url || null;
  } catch (error: any) {
    // 不阻塞主功能，仅在控制台输出
    console.error('获取操作手册链接失败', error);
  }
});
</script>

<style scoped>
.sidebar-container {
  position: fixed;
  left: 0;
  top: 0;
  height: 100vh;
  width: 80px;
  background: var(--app-bg-sub);
  border-right: 1px solid var(--app-border-color);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 20px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  align-items: center;
  flex: 1;
  padding-bottom: 50px;
}

.sidebar-spacer {
  flex: 1;
  min-height: 12px;
}

.nav-item {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  color: var(--text-muted);
}

.nav-item:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.nav-item.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

@media (max-width: 768px) {
  .sidebar-container {
    width: 60px;
  }
  
  .nav-item {
    width: 40px;
    height: 40px;
  }
}
</style>
