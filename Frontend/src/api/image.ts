import request from '@/utils/request.ts';

export interface GenerateParams {
    apiType: 'dream' | 'nano';
    prompt: string;
    width?: number;
    height?: number;
}

// 调用生图接口
export const generateImage = (data: GenerateParams) => {
    return request.post('/image/generate', data);
};