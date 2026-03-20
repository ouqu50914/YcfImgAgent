export type BrowserNotificationOptions = {
  title: string;
  body?: string;
  tag?: string;
  /** 同 tag 再次显示时是否提醒（可用于失败结果） */
  renotify?: boolean;
};

const PERMISSION_REQUESTED_KEY = "browser_notification_permission_requested_v1";

const canUseNotification = () =>
  typeof window !== "undefined" && "Notification" in window;

/** 当前浏览器通知权限状态（不可用时返回 unsupported） */
export function getBrowserNotificationState(): NotificationPermission | "unsupported" {
  if (!canUseNotification()) return "unsupported";
  return Notification.permission;
}

/**
 * 在用户明确操作（如点击「开启通知」）后请求权限。
 * 与 `ensureBrowserNotificationPermission` 不同：不依赖 localStorage 的「静默只请求一次」逻辑。
 */
export async function requestNotificationPermissionFromUser(): Promise<boolean> {
  if (!canUseNotification()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export async function ensureBrowserNotificationPermission(): Promise<boolean> {
  if (!canUseNotification()) return false;

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  // permission === "default": 仅在首次调用时尝试请求，避免频繁打断用户
  const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === "1";
  if (alreadyRequested) return false;

  localStorage.setItem(PERMISSION_REQUESTED_KEY, "1");
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

export async function showBrowserNotification(opts: BrowserNotificationOptions): Promise<boolean> {
  if (!canUseNotification()) return false;
  const ok = await ensureBrowserNotificationPermission();
  if (!ok) return false;

  // `tag` 用于去重；`renotify` 为 Living Standard 字段，部分 @types 的 NotificationOptions 未收录
  try {
    const notificationOpts = {
      body: opts.body,
      tag: opts.tag,
      renotify: opts.renotify === true
    } as NotificationOptions & { renotify?: boolean };
    // eslint-disable-next-line no-new
    new Notification(opts.title, notificationOpts);
    return true;
  } catch {
    return false;
  }
}

/** 工作流「图片 / 视频」生成结果（成功或失败），普通用户也可用 */
export async function notifyMediaGeneration(opts: {
  kind: "image" | "video";
  success: boolean;
  nodeId: string;
  /** 副标题说明，失败时尽量传可读原因 */
  message: string;
}): Promise<boolean> {
  const label = opts.kind === "image" ? "图片" : "视频";
  const title = opts.success ? `${label}生成成功` : `${label}生成失败`;
  const tag = opts.success
    ? `gen_${opts.kind}_ok_${opts.nodeId}`
    : `gen_${opts.kind}_fail_${opts.nodeId}_${Date.now()}`;
  return showBrowserNotification({
    title,
    body: opts.message,
    tag,
    renotify: !opts.success
  });
}
