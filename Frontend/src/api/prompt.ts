import request from '@/utils/request.ts';

export interface OptimizeParams {
    prompt: string;
    apiType?: 'dream' | 'nano';
    style?: string;
}

export interface PromptTemplate {
    id: number;
    user_id: number;
    name: string;
    content: string;
    description?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateTemplateParams {
    name: string;
    content: string;
    description?: string;
}

export interface UpdateTemplateParams {
    name?: string;
    content?: string;
    description?: string;
}

// 调用提示词优化接口
export const optimizePrompt = (data: OptimizeParams) => {
    return request.post('/prompt/optimize', data);
};

// 提示词模板相关接口
export const createPromptTemplate = (data: CreateTemplateParams) => {
    return request.post('/prompt/templates', data);
};

export const getPromptTemplates = () => {
    return request.get('/prompt/templates');
};

export const getPromptTemplate = (id: number) => {
    return request.get(`/prompt/templates/${id}`);
};

export const updatePromptTemplate = (id: number, data: UpdateTemplateParams) => {
    return request.put(`/prompt/templates/${id}`, data);
};

export const deletePromptTemplate = (id: number) => {
    return request.delete(`/prompt/templates/${id}`);
};

export const searchPromptTemplates = (keyword: string) => {
    return request.get('/prompt/templates/search', { params: { keyword } });
};
