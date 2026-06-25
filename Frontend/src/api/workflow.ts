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
  /** 是否临时项目：1=临时，0=正式 */
  is_temp?: number;
  /** 若为临时项目，则记录来源公开模板 ID */
  source_template_id?: number | null;
}

export const saveTemplate = (data: {
  name: string;
  workflowData: any;
  description?: string;
  isPublic?: boolean;
  isFavorite?: boolean;
  coverImage?: string;
  category: string;
  isTemp?: boolean;
  sourceTemplateId?: number;
}) => {
  return request.post<{ message: string; data: WorkflowTemplate }>('/workflow/template', data);
};

export const getTemplates = (options?: { lite?: boolean }) => {
  return request.get<{ message: string; data: WorkflowTemplate[] }>('/workflow/templates', {
    params: options?.lite ? { lite: 1 } : undefined,
  });
};

export interface RecentProjectItem {
  id: number;
  name: string;
  preview?: string;
  created_at: string;
  updated_at: string;
  source: 'template' | 'history';
}

export const getRecentProjects = (limit = 5) => {
  return request.get<{ message: string; data: RecentProjectItem[] }>('/workflow/recent-projects', {
    params: { limit },
  });
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
  isTemp?: boolean;
  sourceTemplateId?: number | null;
}) => {
  return request.put<{ message: string; data: WorkflowTemplate }>(`/workflow/template/${id}`, data);
};

export const deleteTemplate = (id: number) => {
  return request.delete<{ message: string }>(`/workflow/template/${id}`);
};

// 工作流历史相关
export interface WorkflowHistory {
  id: number;
  user_id?: number;
  template_id?: number | null;
  workflow_data?: any;
  snapshot_name?: string;
  created_at: string;
  updated_at?: string;
  is_public?: number;
  is_favorite?: number;
  /** 列表接口会解析 workflow_data 后返回的封面图 URL */
  cover_image?: string;
}

export const autoSaveHistory = (workflowData: any, historyId?: number, templateId?: number) => {
  return request.post<{ message: string; data: WorkflowHistory }>('/workflow/history/auto-save', {
    workflowData,
    ...(historyId != null ? { historyId } : {}),
    ...(templateId != null ? { templateId } : {})
  });
};

export const getHistoryList = (limit?: number, templateId?: number, options?: { lite?: boolean }) => {
  return request.get<{ message: string; data: WorkflowHistory[] }>('/workflow/history', {
    params: {
      limit,
      ...(templateId != null ? { templateId } : {}),
      ...(options?.lite ? { lite: 1 } : {}),
    }
  });
};

export const getHistory = (id: number) => {
  return request.get<{ message: string; data: WorkflowHistory }>(`/workflow/history/${id}`);
};

export const updateHistory = (id: number, data: { isPublic?: boolean; isFavorite?: boolean; snapshot_name?: string }) => {
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

// 创意广场相关
export type CreativeSquareProjectSource = 'template' | 'history';

export interface CreativeSquareLatestProject {
  id: number;
  source: CreativeSquareProjectSource;
  name: string;
  cover_image?: string;
  updated_at: string;
}

export interface CreativeSquareMember {
  user_id: number;
  username: string;
  latest_project: CreativeSquareLatestProject;
  project_count: number;
}

export interface CreativeSquareMemberProject {
  id: number;
  source: CreativeSquareProjectSource;
  name: string;
  cover_image?: string;
  updated_at: string;
  is_own: boolean;
}

export interface CreativeSquareForkData {
  name: string;
  workflow_data: any;
  cover_image?: string;
  owner_id: number;
}

export const getCreativeSquareMembers = () => {
  return request.get<{ message: string; data: { list: CreativeSquareMember[] } }>('/workflow/creative-square/members');
};

export const getCreativeSquareMemberProjects = (userId: number) => {
  return request.get<{ message: string; data: { list: CreativeSquareMemberProject[] } }>(
    `/workflow/creative-square/members/${userId}/projects`
  );
};

export const getCreativeSquareFork = (source: CreativeSquareProjectSource, id: number) => {
  return request.get<{ message: string; data: CreativeSquareForkData }>(
    `/workflow/creative-square/fork/${source}/${id}`
  );
};
