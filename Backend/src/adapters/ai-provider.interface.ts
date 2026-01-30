export interface GenerateParams {
    prompt: string;
    width?: number;
    height?: number;
    style?: string; // 风格：cyberpunk, anime, realistic
    num_images?: number;
}

export interface AiResponse {
    original_id: string; // 第三方API返回的任务ID
    images?: string[];   // 图片URL（如果是同步返回）
}

export interface AiProvider {
    generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
}