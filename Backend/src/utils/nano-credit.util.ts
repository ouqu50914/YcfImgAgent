export type NanoProviderHint = 'ace' | 'anyfast';

/** AnyFast Gemini 旧 preview 名 → 正式版 */
export function normalizeAnyfastGeminiModel(model?: string): string | undefined {
    if (!model) return model;
    if (model === 'gemini-3-pro-image-preview') return 'gemini-3-pro-image';
    if (model === 'gemini-3.1-flash-image-preview') return 'gemini-3.1-flash-image';
    return model;
}

export function isAnyfastGeminiProModel(model?: string): boolean {
    const m = normalizeAnyfastGeminiModel(model);
    return m === 'gemini-3-pro-image';
}

/**
 * 解析 Nano 线路供应商（与前端 getCreditCost 保持一致）
 */
export function resolveNanoProvider(
    model?: string,
    providerHint?: NanoProviderHint
): NanoProviderHint {
    if (providerHint === 'ace' || providerHint === 'anyfast') return providerHint;
    if (model?.startsWith('gemini-')) return 'anyfast';
    if (model === 'gpt-image-2-c') return 'anyfast';
    if (model === 'gpt-image-2.5-sunburst' || model === 'gpt-image-2.5-flare') return 'anyfast';
    if (model === 'gpt-image-2') return 'ace';
    if (model?.startsWith('nano-banana-')) return 'ace';
    return 'ace';
}

export function isGptImage2Model(model?: string): boolean {
    return model === 'gpt-image-2'
        || model === 'gpt-image-2-c'
        || model === 'gpt-image-2.5-sunburst'
        || model === 'gpt-image-2.5-flare';
}

/**
 * 计算 Nano 生图积分（单张单价 × 张数）
 */
export function calcNanoGenerateCredits(options: {
    model?: string;
    providerHint?: NanoProviderHint;
    quality?: string;
    imageCount?: number;
}): number {
    const count = options.imageCount ?? 1;
    const quality = options.quality === '4K' ? '4K' : '2K';
    const model = normalizeAnyfastGeminiModel(options.model);
    const provider = resolveNanoProvider(model, options.providerHint);

    if (provider === 'anyfast') {
        if (isGptImage2Model(model)) {
            const q = options.quality === 'high' ? 'high' : options.quality === 'low' ? 'low' : 'medium';
            const perImage = q === 'high' ? 18 : q === 'low' ? 10 : 14;
            return perImage * count;
        }
        const perImage = isAnyfastGeminiProModel(model)
            ? (quality === '4K' ? 20 : 15)
            : (quality === '4K' ? 15 : 11);
        return perImage * count;
    }

    return 6 * count;
}

/**
 * 写入 credit_usage_log.api_type 的统计键（varchar 20）
 */
export function buildCreditUsageApiType(
    apiType: 'dream' | 'nano' | 'midjourney',
    model?: string,
    providerHint?: NanoProviderHint
): string {
    if (apiType !== 'nano') return apiType;
    const normalized = normalizeAnyfastGeminiModel(model);
    if (normalized === 'gpt-image-2.5-sunburst') return 'img2.5';
    if (normalized === 'gpt-image-2.5-flare') return 'img2.5-fast';
    if (normalized === 'gpt-image-2-c') return 'gpt-image-2-c';
    if (normalized === 'gpt-image-2' && providerHint === 'anyfast') return 'gpt-image-2-af';
    if (normalized === 'gemini-3-pro-image') return 'gemini-3-pro';
    if (normalized === 'gemini-3.1-flash-image') return 'gemini-3.1-fl';
    if (normalized?.startsWith('nano-banana-')) return 'nano-ace';
    return 'nano';
}

/** 管理后台展示名 */
export function getCreditUsageApiTypeLabel(apiType: string): string {
    const map: Record<string, string> = {
        dream: 'Dream(文生图)',
        nano: 'Nano(通用)',
        midjourney: 'Midjourney',
        'img2.5': 'GPT Image 2.5(AnyFast)',
        'img2.5-fast': 'GPT Image 2.5-Fast(AnyFast)',
        'gpt-image-2-c': 'GPT Image 2-C(AnyFast)',
        'gpt-image-2-af': 'GPT Image 2(AnyFast)',
        'gemini-3-pro': 'NanoBanana Pro(AnyFast)',
        'gemini-3.1-fl': 'NanoBanana2(AnyFast)',
        'nano-ace': 'Nano(Ace)',
    };
    return map[apiType] || apiType;
}
