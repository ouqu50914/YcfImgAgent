import request from '@/utils/request';

/** 获取当前用户信息（含积分） */
export const getMe = () => request.get<{ data: { id: number; username: string; role: number; credits: number } }>('/auth/me');

/** 提交积分申请 */
export const applyCredits = (amount: number, reason?: string) =>
  request.post('/user/credit-application', { amount, reason });

/** 获取前端可用的操作手册链接（当前复用 admin 接口，需要登录且有权限时才能获取） */
export const getHelpDocUrlForClient = () => request.get<{ url: string | null }>('/user/config/help-doc-url');
