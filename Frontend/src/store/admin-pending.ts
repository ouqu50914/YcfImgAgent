import { defineStore } from 'pinia';
import { getPendingCreditApplicationCount } from '@/api/admin';
import { getUserRoleFromInfo } from '@/utils/user-role';
import { useUserStore } from '@/store/user';

/** 超级管理员：待处理事项（如积分申请）数量，用于全局红点 */
export const useAdminPendingStore = defineStore('adminPending', {
  state: () => ({
    pendingCreditApplicationCount: 0
  }),
  getters: {
    showPendingCreditDot: (s): boolean => s.pendingCreditApplicationCount > 0
  },
  actions: {
    async refreshPendingCreditApplications(): Promise<void> {
      const userStore = useUserStore();
      const role = getUserRoleFromInfo(userStore.userInfo);
      if (!userStore.token || role !== 1) {
        this.pendingCreditApplicationCount = 0;
        return;
      }
      try {
        const res: any = await getPendingCreditApplicationCount();
        const n = res?.data?.count;
        this.pendingCreditApplicationCount = typeof n === 'number' && n >= 0 ? n : 0;
      } catch {
        // 静默失败，避免打搅管理员操作
      }
    }
  }
});
