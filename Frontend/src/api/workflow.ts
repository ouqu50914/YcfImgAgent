import request from '@/utils/request';

export interface WorkflowTemplate {
  id: number;
  user_id?: number;
  name: string;
  description?: string;
  workflow_data: any;
  is_public: number;
  is_favorite?: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
  cover_image?: string;
  author_name?: string;
  expires_at?: string;
  category?: string;
}

export const saveTemplate = (data: {
  name: string;
  workflowData: any;
  description?: string;
  isPublic?: boolean;
  isFavorite?: boolean;
  coverImage?: string;
  category: string;
}) => {
  return request.post<{ message: string; data: WorkflowTemplate }>('/workflow/template', data);
};

export const getTemplates = () => {
  return request.get<{ message: string; data: WorkflowTemplate[] }>('/workflow/templates');
};

export const getTemplate = (id: number) => {
  return request.get<{ message: string; data: WorkflowTemplate }>(`/workflow/template/${id}`);
};

export const updateTemplate = (id: number, data: {
  name?: string;
  description?: string;
  workflowData?: any;
  isPublic?: boolean;
  isFavorite?: boolean;
  coverImage?: string;
  category?: string;
}) => {
  return request.put<{ message: string; data: WorkflowTemplate }>(`/workflow/template/${id}`, data);
};

export const deleteTemplate = (id: number) => {
  return request.delete<{ message: string }>(`/workflow/template/${id}`);
};

// 工作流历史相关
export interface WorkflowHistory {
  id: number;
  workflow_data?: any;
  snapshot_name?: string;
  created_at: string;
  updated_at?: string;
  is_public?: number;
  is_favorite?: number;
  /** 列表接口会解析 workflow_data 后返回的封面图 URL */
  cover_image?: string;
}

export const autoSaveHistory = (workflowData: any, historyId?: number) => {
  return request.post<{ message: string; data: WorkflowHistory }>('/workflow/history/auto-save', {
    workflowData,
    ...(historyId != null ? { historyId } : {})
  });
};

export const getHistoryList = (limit?: number) => {
  return request.get<{ message: string; data: WorkflowHistory[] }>('/workflow/history', {
    params: { limit }
  });
};

export const getHistory = (id: number) => {
  return request.get<{ message: string; data: WorkflowHistory }>(`/workflow/history/${id}`);
};

export const updateHistory = (id: number, data: { isPublic?: boolean; isFavorite?: boolean }) => {
  return request.put<{ message: string; data: WorkflowHistory }>(`/workflow/history/${id}`, data);
};

export const deleteHistory = (id: number) => {
  return request.delete<{ message: string }>(`/workflow/history/${id}`);
};

// 工作流广场相关
export const getPublicTemplates = (params?: {
  keyword?: string;
  category?: string;
  sortBy?: 'time' | 'usage';
  page?: number;
  pageSize?: number;
}) => {
  return request.get<{ message: string; data: { list: WorkflowTemplate[]; total: number } }>('/workflow/templates/public', {
    params
  });
};
