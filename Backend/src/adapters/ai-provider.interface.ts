export interface GenerateParams {
    prompt: string;
    width?: number;
    height?: number;
    style?: string; // 风格：cyberpunk, anime, realistic
    num_images?: number; // 生成图片数量，1-4
    imageUrl?: string; // 单图生图时使用的参考图片URL
    imageUrls?: string[]; // 多图生图时使用的参考图片URL数组
    quality?: string; // 画质：1K、2K、4K（豆包API方式1）
    model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview'; // Nano 模型选择
}

export interface UpscaleParams {
    imageUrl: string; // 原图片URL
    scale?: number;  // 放大倍数：2 或 4，默认2
}

export interface ExtendParams {
    imageUrl: string; // 原图片URL
    direction: 'top' | 'bottom' | 'left' | 'right' | 'all'; // 扩展方向
    width?: number;   // 扩展后的宽度
    height?: number; // 扩展后的高度
    ratio?: string;  // 比例：auto, 1:1, 4:3, 3:4, 16:9, 9:16 等
    prompt?: string;  // 扩展区域的提示词
}

export interface AiResponse {
    original_id: string; // 第三方API返回的任务ID
    images?: string[];   // 图片URL（如果是同步返回）
}

export interface AiProvider {
    generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
    upscaleImage?(params: UpscaleParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
    extendImage?(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
}