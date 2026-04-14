export interface GenerateParams {
    prompt: string;
    /**
     * 前端生成的幂等 key。
     * 用于刷新/历史恢复后通过该 key 查询服务端已完成的生成结果。
     */
    generationKey?: string;
    width?: number;
    height?: number;
    style?: string; // 风格：cyberpunk, anime, realistic
    num_images?: number; // 生成图片数量，1-4
    imageUrl?: string; // 单图生图时使用的参考图片URL
    imageUrls?: string[]; // 多图生图时使用的参考图片URL数组
    /** 与 imageUrls 同顺序的图片别名数字（例如 4 表示“图4”），用于构建 @图N 与具体图片的映射说明 */
    imageAliases?: number[];
    quality?: string; // 画质：1K、2K、4K（Nano Banana Pro）或 standard（Seedream）
    model?: 'nano-banana-2' | 'nano-banana-pro' | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'midjourney'; // 模型选择
    aspectRatio?: string; // 比例字符串，如 "1:1", "16:9"（Nano 使用，Seedream 用于计算尺寸）
    providerHint?: 'ace' | 'anyfast'; // 可选的供应商提示
    mode?: 'fast' | 'relax' | 'turbo'; // Midjourney 生成模式
    timeout?: number; // Midjourney 超时（秒）
    translation?: boolean; // Midjourney 非英文提示词自动翻译
    splitImages?: boolean; // Midjourney 是否拆分 2x2 图
    mjAction?: string; // Midjourney 动作（默认 generate）
    imageId?: string; // Midjourney 历史图像 ID（继续操作时）
    callbackUrl?: string; // Midjourney 异步回调地址
    taskId?: string; // Midjourney 任务 ID（兜底查询）
    /** 工作流项目 workflow_template.id */
    templateId?: number;
}

export interface UpscaleParams {
    imageUrl: string; // 原图片URL
    scale?: number;  // 放大倍数：2 或 4，默认2
    templateId?: number;
}

export interface ExtendParams {
    imageUrl: string; // 原图片URL
    direction: 'top' | 'bottom' | 'left' | 'right' | 'all'; // 扩展方向
    width?: number;   // 扩展后的宽度
    height?: number; // 扩展后的高度
    ratio?: string;  // 比例：auto, 1:1, 4:3, 3:4, 16:9, 9:16 等
    prompt?: string;  // 扩展区域的提示词
    templateId?: number;
}

export interface SplitParams {
    imageUrl: string; // 要拆分的图片URL
    splitCount?: number; // 拆分的数量，默认为 2
    splitDirection?: 'horizontal' | 'vertical'; // 拆分方向，水平或垂直
    prompt?: string;  // 拆分的提示词，用于指导拆分过程
    templateId?: number;
}

export interface AiResponse {
    original_id: string; // 第三方API返回的任务ID
    images?: string[];   // 图片URL（如果是同步返回）
}

export interface AiProvider {
    generateImage(params: GenerateParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
    upscaleImage?(params: UpscaleParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
    extendImage?(params: ExtendParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
    splitImage?(params: SplitParams, apiKey: string, apiUrl: string): Promise<AiResponse>;
}