import request from '@/utils/request.ts';

export interface GenerateParams {
    apiType: 'dream' | 'nano';
    prompt: string;
    /** 工作流项目 ID */
    templateId?: number;
    /**
     * 前端生成的幂等 key，用于刷新/历史恢复后查询最终生成结果
     */
    generationKey?: string;
    width?: number;
    height?: number;
    numImages?: number; // 生成图片数量，1-4
    imageUrl?: string; // 单图生图时使用的参考图片URL
    imageUrls?: string[]; // 多图生图时使用的参考图片URL数组
    quality?: string; // 画质：1K、2K、4K（豆包API方式1）
    model?: 'nano-banana-2' | 'nano-banana-pro' | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';
    providerHint?: 'ace' | 'anyfast';
}

export interface UpscaleParams {
    apiType: 'dream' | 'nano';
    imageUrl: string;
    scale?: number; // 2 或 4
    templateId?: number;
}

export interface ExtendParams {
    apiType: 'dream' | 'nano';
    imageUrl: string;
    templateId?: number;
    direction: 'top' | 'bottom' | 'left' | 'right' | 'all';
    width?: number;
    height?: number;
    ratio?: string; // 比例：auto, 1:1, 4:3, 3:4, 16:9, 9:16 等
    prompt?: string;
}

export interface SplitParams {
    apiType: 'dream' | 'nano';
    imageUrl: string;
    templateId?: number;
    splitCount: number;
    splitDirection: 'horizontal' | 'vertical';
    prompt?: string;
}

// 调用生图接口
export const generateImage = (data: GenerateParams) => {
    return request.post('/image/generate', data);
};

export const getImageGenerateResultByGenerationKey = (generationKey: string) => {
    return request.get<{
        message: string;
        data: {
            id: number;
            status: number; // 1 成功 / 0 失败/未完成
            image_url?: string;
            all_images: string[];
            created_at?: string;
        };
    }>(`/image/generate-result`, {
        params: { generationKey },
    });
};

// 调用放大接口
export const upscaleImage = (data: UpscaleParams) => {
    return request.post('/image/upscale', data);
};

// 调用扩展接口
export const extendImage = (data: ExtendParams) => {
    return request.post('/image/extend', data);
};

// 调用拆分接口
export const splitImage = (data: SplitParams) => {
    return request.post('/image/split', data);
};

/** 当前用户的图片生成记录 */
export const listImageResults = (params?: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    templateId?: number;
    status?: number;
}) => {
    return request.get('/image/results', { params });
};