<template>
  <div class="sidebar-container">
    <div class="sidebar-nav">
      <div 
        class="nav-item"
        :class="{ active: currentRoute === '/workflow' && !routeQuery }"
        @click="handleNavClick('/workflow')"
        title="新建工作流"
      >
        <el-icon :size="24"><Plus /></el-icon>
      </div>
      <div 
        class="nav-item"
        :class="{ active: currentRoute === '/home' || currentRoute === '/' }"
        @click="handleNavClick('/home')"
        title="首页"
      >
        <el-icon :size="24"><House /></el-icon>
      </div>
      <div 
        class="nav-item"
        :class="{ active: currentRoute === '/workflow-plaza' }"
        @click="handleNavClick('/workflow-plaza')"
        title="我的工作流"
      >
        <el-icon :size="24"><Folder /></el-icon>
      </div>
      <div 
        class="nav-item"
        :class="{ active: currentRoute === '/workflow-plaza' && isPublic }"
        @click="handleNavClick('/workflow-plaza', { public: true })"
        title="模板库"
      >
        <el-icon :size="24"><Document /></el-icon>
      </div>
      <div 
        class="nav-item"
        :class="{ active: currentRoute === '/profile' }"
        @click="handleNavClick('/profile')"
        title="设置"
      >
        <el-icon :size="24"><Setting /></el-icon>
      </div>
      <div 
        v-if="isAdmin"
        class="nav-item"
        :class="{ active: currentRoute === '/admin' }"
        @click="handleNavClick('/admin')"
        title="后台管理"
      >
        <el-icon :size="24"><UserFilled /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Plus, House, Folder, Document, Setting, UserFilled } from '@element-plus/icons-vue';
import { useUserStore } from '@/store/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

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
</script>

<style scoped>
.sidebar-container {
  position: fixed;
  left: 0;
  top: 0;
  height: 100vh;
  width: 80px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
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
  color: #606266;
}

.nav-item:hover {
  background: #f5f7fa;
  color: #409eff;
}

.nav-item.active {
  background: #ecf5ff;
  color: #409eff;
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
