import request from '@/utils/request';

export interface WorkflowCategory {
  id: number;
  name: string;
  code: string;
  description?: string;
  sort_order: number;
  status: number;
  created_at: string;
  updated_at: string;
}

// 获取所有启用的分类（公开接口）
export const getActiveCategories = () => {
  return request.get<{ message: string; data: WorkflowCategory[] }>('/workflow/categories');
};

// 获取所有分类（管理员接口）
export const getAllCategories = () => {
  return request.get<{ message: string; data: WorkflowCategory[] }>('/admin/categories');
};

// 创建分类（管理员接口）
export const createCategory = (data: {
  name: string;
  code: string;
  description?: string;
  sort_order?: number;
  status?: number;
}) => {
  return request.post<{ message: string; data: WorkflowCategory }>('/admin/categories', data);
};

// 更新分类（管理员接口）
export const updateCategory = (id: number, data: {
  name?: string;
  code?: string;
  description?: string;
  sort_order?: number;
  status?: number;
}) => {
  return request.put<{ message: string; data: WorkflowCategory }>(`/admin/categories/${id}`, data);
};

// 删除分类（管理员接口）
export const deleteCategory = (id: number) => {
  return request.delete<{ message: string }>(`/admin/categories/${id}`);
};
