const EVENT = 'app:workflow-list-changed';

/** 工作流项目增删改后通知首页等区域刷新列表 */
export function notifyWorkflowListChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function onWorkflowListChanged(handler: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
