<script setup lang="ts">
import { watch, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/store/user';
import { useAdminPendingStore } from '@/store/admin-pending';
import { syncAdminNotificationStream, stopAdminNotificationStream } from '@/utils/admin-notification-hub';
import { offerAdminCreditNotificationGuide } from '@/utils/admin-notification-permission-guide';
import { getUserRoleFromInfo } from '@/utils/user-role';

const userStore = useUserStore();
const adminPendingStore = useAdminPendingStore();
const router = useRouter();

let adminPendingPollTimer: ReturnType<typeof setInterval> | null = null;

function syncAdminPendingBadgePolling() {
  if (adminPendingPollTimer) {
    clearInterval(adminPendingPollTimer);
    adminPendingPollTimer = null;
  }
  const role = getUserRoleFromInfo(userStore.userInfo);
  if (!userStore.token || role !== 1) {
    void adminPendingStore.refreshPendingCreditApplications();
    return;
  }
  void adminPendingStore.refreshPendingCreditApplications();
  adminPendingPollTimer = setInterval(() => {
    void adminPendingStore.refreshPendingCreditApplications();
  }, 60000);
}

function refreshAdminRealtime() {
  const role = getUserRoleFromInfo(userStore.userInfo);
  syncAdminNotificationStream(userStore.token, role);
}

// token / 角色变化时同步 SSE；避免因 userInfo 仅有 role_id 导致永远不连上
watch(
  [() => userStore.token, () => getUserRoleFromInfo(userStore.userInfo)],
  async ([token, role], prev) => {
    const [pt, pr] = prev ?? ['', undefined];

    refreshAdminRealtime();
    syncAdminPendingBadgePolling();

    // 仅在登录、登出或角色变化时提示开启通知，避免 fetchCredits 替换 userInfo 时反复弹窗
    if (token && role === 1 && (token !== pt || role !== pr)) {
      await nextTick();
      void offerAdminCreditNotificationGuide();
    }
  },
  { immediate: true }
);

// 路由切换后再尝试同步一次（防止极少数异步写入 userInfo 后未触发 watch）
router.afterEach(() => {
  refreshAdminRealtime();
  void adminPendingStore.refreshPendingCreditApplications();
});

onUnmounted(() => {
  if (adminPendingPollTimer) clearInterval(adminPendingPollTimer);
  stopAdminNotificationStream();
});
</script>

<template>
  <router-view />
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  width: 100%;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
}

#app {
  min-height: 100vh;
  width: 100%;
}

/* 图片预览（el-image 预览、全屏预览）去掉滚动条 */
.el-image-viewer__wrapper,
.el-image-viewer__canvas {
  overflow: hidden !important;
}
</style>
