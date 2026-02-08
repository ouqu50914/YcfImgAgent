import request from '@/utils/request';

// 用户管理
export const getUserList = (params?: { page?: number; pageSize?: number; username?: string; status?: number }) => {
  return request.get('/admin/users', { params });
};

export const createUser = (data: { username: string; password: string; role_id?: number }) => {
  return request.post('/admin/users', data);
};

export const updateUser = (id: number, data: { username?: string; role_id?: number; status?: number; credits?: number }) => {
  return request.put(`/admin/users/${id}`, data);
};

export const updateUserCredits = (id: number, credits: number) => {
  return request.put(`/admin/users/${id}/credits`, { credits });
};

export const getCreditApplications = (status?: string) => {
  return request.get('/admin/credit-applications', { params: status ? { status } : {} });
};

export const approveCreditApplication = (id: number, data?: { amount?: number; admin_comment?: string }) => {
  return request.post(`/admin/credit-applications/${id}/approve`, data || {});
};

export const rejectCreditApplication = (id: number, data?: { admin_comment?: string }) => {
  return request.post(`/admin/credit-applications/${id}/reject`, data || {});
};

export const resetPassword = (id: number, newPassword: string) => {
  return request.post(`/admin/users/${id}/reset-password`, { newPassword });
};

export const deleteUser = (id: number) => {
  return request.delete(`/admin/users/${id}`);
};

export const getUserStats = (
  id: number,
  params?: { startDate?: string; endDate?: string; apiType?: string }
) => {
  return request.get(`/admin/users/${id}/stats`, { params });
};

// 日志查看
export const getOperationLogs = (params?: {
  userId?: number;
  operationType?: string;
  apiType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) => {
  return request.get('/admin/logs', { params });
};

// API配置管理
export const getApiConfigs = () => {
  return request.get('/admin/api-configs');
};

export const updateApiConfig = (apiType: string, data: { status?: number; user_daily_limit?: number }) => {
  return request.put(`/admin/api-configs/${apiType}`, data);
};

// 系统配置 - 操作手册链接
export const getHelpDocUrl = () => {
  return request.get<{ url: string | null }>('/admin/config/help-doc-url');
};

export const updateHelpDocUrl = (url: string) => {
  return request.put('/admin/config/help-doc-url', { url });
};
