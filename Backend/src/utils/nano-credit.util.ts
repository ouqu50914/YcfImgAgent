export type NanoProviderHint = 'ace' | 'anyfast';

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
    if (model === 'gpt-image-2') return 'ace';
    if (model?.startsWith('nano-banana-')) return 'ace';
    return 'ace';
}

export function isGptImage2Model(model?: string): boolean {
    return model === 'gpt-image-2' || model === 'gpt-image-2-c';
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
    const model = options.model;
    const provider = resolveNanoProvider(model, options.providerHint);

    if (provider === 'anyfast') {
        if (isGptImage2Model(model)) {
            const q = options.quality === 'high' ? 'high' : options.quality === 'low' ? 'low' : 'medium';
            const perImage = q === 'high' ? 18 : q === 'low' ? 10 : 14;
            return perImage * count;
        }
        const perImage = model === 'gemini-3-pro-image-preview'
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
    if (model === 'gpt-image-2-c') return 'gpt-image-2-c';
    if (model === 'gpt-image-2' && providerHint === 'anyfast') return 'gpt-image-2-af';
    if (model === 'gemini-3-pro-image-preview') return 'gemini-3-pro';
    if (model === 'gemini-3.1-flash-image-preview') return 'gemini-3.1-fl';
    if (model?.startsWith('nano-banana-')) return 'nano-ace';
    return 'nano';
}

/** 管理后台展示名 */
export function getCreditUsageApiTypeLabel(apiType: string): string {
    const map: Record<string, string> = {
        dream: 'Dream(文生图)',
        nano: 'Nano(通用)',
        midjourney: 'Midjourney',
        'gpt-image-2-c': 'GPT Image 2-C(AnyFast)',
        'gpt-image-2-af': 'GPT Image 2(AnyFast)',
        'gemini-3-pro': 'NanoBanana Pro(AnyFast)',
        'gemini-3.1-fl': 'NanoBanana2(AnyFast)',
        'nano-ace': 'Nano(Ace)',
    };
    return map[apiType] || apiType;
}
