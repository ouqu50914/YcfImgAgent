import request from '@/utils/request.ts';

export interface GenerateParams {
    apiType: 'dream' | 'nano';
    prompt: string;
    width?: number;
    height?: number;
    numImages?: number; // 生成图片数量，1-4
    imageUrl?: string; // 单图生图时使用的参考图片URL
    imageUrls?: string[]; // 多图生图时使用的参考图片URL数组
    quality?: string; // 画质：1K、2K、4K（豆包API方式1）
}

export interface UpscaleParams {
    apiType: 'dream' | 'nano';
    imageUrl: string;
    scale?: number; // 2 或 4
}

export interface ExtendParams {
    apiType: 'dream' | 'nano';
    imageUrl: string;
    direction: 'top' | 'bottom' | 'left' | 'right' | 'all';
    width?: number;
    height?: number;
    ratio?: string; // 比例：auto, 1:1, 4:3, 3:4, 16:9, 9:16 等
    prompt?: string;
}

// 调用生图接口
export const generateImage = (data: GenerateParams) => {
    return request.post('/image/generate', data);
};

// 调用放大接口
export const upscaleImage = (data: UpscaleParams) => {
    return request.post('/image/upscale', data);
};

// 调用扩展接口
export const extendImage = (data: ExtendParams) => {
    return request.post('/image/extend', data);
};