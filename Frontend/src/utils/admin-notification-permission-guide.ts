import { nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { requestNotificationPermissionFromUser } from '@/utils/browser-notification';

/** 同标签页会话内：已提醒过「通知被禁止」则不再重复弹窗 */
const NOTIFY_DENIED_SESSION_KEY = 'browser_notify_denied_hint_session';

/**
 * 超级专用：在任意页面提示开启系统通知（与是否打开 /admin 无关）。
 * 未授权 default：每次登录或角色变为超管时由 App.vue 触发；已 grant/deny 会尽快 return。
 */
export async function offerAdminCreditNotificationGuide() {
  await nextTick();

  if (typeof Notification === 'undefined') {
    ElMessage.info('当前环境不支持浏览器系统通知，您仍可在「积分申请」中查看待处理申请。');
    return;
  }
  if (Notification.permission === 'granted') return;

  if (Notification.permission === 'denied') {
    if (sessionStorage.getItem(NOTIFY_DENIED_SESSION_KEY)) return;
    sessionStorage.setItem(NOTIFY_DENIED_SESSION_KEY, '1');
    try {
      await ElMessageBox.alert(
        '当前浏览器已禁止本站发送通知，页面内无法再次弹出系统授权。\n\n' +
          '如需桌面提醒「新积分申请」，请在浏览器地址栏旁打开站点信息/权限，将「通知」改为允许。',
        '通知未开启',
        { confirmButtonText: '知道了', type: 'warning' }
      );
    } catch {
      /* 关闭弹窗 */
    }
    return;
  }

  try {
    await ElMessageBox.confirm(
      '检测到尚未开启浏览器通知。\n\n' +
        '开启后，在您保持本网站任一页面打开且已登录超级管理员账号时，普通用户提交「积分申请」会尝试向您发送系统桌面通知。\n\n' +
        '点击「开启通知」后，浏览器将询问是否允许；也可先选「暂不」，之后在「管理后台 - 积分申请」中手动处理。',
      '开启积分申请提醒',
      {
        confirmButtonText: '开启通知',
        cancelButtonText: '暂不',
        type: 'info',
        distinguishCancelAndClose: true
      }
    );
  } catch {
    return;
  }

  const ok = await requestNotificationPermissionFromUser();
  if (ok) {
    ElMessage.success('已开启通知：有新积分申请时将尝试提醒您');
  } else {
    ElMessage.info('未获得通知权限：有新申请时不会在桌面弹出，仍可在「积分申请」中查看');
  }
}
