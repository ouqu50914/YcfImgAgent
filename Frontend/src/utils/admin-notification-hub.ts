import { ElMessage } from 'element-plus';
import { connectAdminNotificationStream } from '@/utils/admin-notification-stream';
import { showBrowserNotification } from '@/utils/browser-notification';
import { useAdminPendingStore } from '@/store/admin-pending';

let closeStream: (() => void) | null = null;
let boundToken: string | null = null;

/**
 * 超级管理员：任意页面保持一条 SSE，接收积分申请等事件。
 * 与是否打开 /admin 无关。
 */
export function syncAdminNotificationStream(token: string | null | undefined, role: number | undefined | null) {
  const rid = role == null ? undefined : Number(role);
  if (!token || rid !== 1) {
    stopAdminNotificationStream();
    return;
  }
  if (boundToken === token && closeStream) return;

  stopAdminNotificationStream();
  boundToken = token;

  const stream = connectAdminNotificationStream({
    token,
    onEvent: (e) => {
      if (e.event === 'credit_application_created' && e.data) {
        const d = e.data as {
          id?: number;
          username?: string;
          amount?: number;
          reason?: string | null;
        };
        const reasonPart = d.reason ? `，原因：${d.reason}` : '';
        const line = `${d.username ?? '用户'}申请${d.amount ?? '?'}积分${reasonPart}`;
        // 站内兜底：避免仅依赖系统通知（权限/缓冲导致看不到）
        ElMessage({
          message: `新积分申请：${line}`,
          type: 'success',
          duration: 12000,
          showClose: true
        });
        void showBrowserNotification({
          title: '新的积分申请',
          body: line,
          tag: `credit_app_${d.id ?? Date.now()}`
        });
        void useAdminPendingStore().refreshPendingCreditApplications();
      }
    }
  });
  closeStream = stream.close;
}

export function stopAdminNotificationStream() {
  closeStream?.();
  closeStream = null;
  boundToken = null;
}
