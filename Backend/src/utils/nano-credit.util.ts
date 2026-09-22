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
    // 产品线默认 AnyFast 优先，按 AnyFast 计费
    if (model === 'gpt-image-2.5-sunburst' || model === 'gpt-image-2.5-flare') return 'anyfast';
    if (model === 'gpt-image-2') return 'anyfast';
    if (model?.startsWith('nano-banana-')) return 'anyfast';
    return 'anyfast';
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
        const perImage = isAnyfastGeminiProModel(model) || model === 'nano-banana-pro'
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
    if (normalized === 'gpt-image-2.5-sunburst') {
        return providerHint === 'ace' ? 'img2.5' : 'img2.5-af';
    }
    if (normalized === 'gpt-image-2.5-flare') {
        return providerHint === 'ace' ? 'img2.5-fast' : 'img2.5f-af';
    }
    if (normalized === 'gpt-image-2-c') return 'gpt-image-2-c';
    if (normalized === 'gpt-image-2') {
        return providerHint === 'ace' ? 'gpt-image-2' : 'gpt-image-2-af';
    }
    if (normalized === 'gemini-3-pro-image' || (normalized === 'nano-banana-pro' && providerHint !== 'ace')) {
        return 'gemini-3-pro';
    }
    if (normalized === 'gemini-3.1-flash-image' || (normalized === 'nano-banana-2' && providerHint !== 'ace')) {
        return 'gemini-3.1-fl';
    }
    if (normalized?.startsWith('nano-banana-')) return 'nano-ace';
    return 'nano';
}

/** 管理后台展示名 */
export function getCreditUsageApiTypeLabel(apiType: string): string {
    const map: Record<string, string> = {
        dream: 'Dream(文生图)',
        nano: 'Nano(通用)',
        midjourney: 'Midjourney',
        'gpt-image-2': 'GPT Image 2(Ace)',
        'img2.5': 'GPT2.5 pro(Ace)',
        'img2.5-fast': 'GPT2.5(Ace)',
        'img2.5-af': 'GPT2.5 pro(AnyFast)',
        'img2.5f-af': 'GPT2.5(AnyFast)',
        'gpt-image-2-c': 'GPT Image 2-C(AnyFast)',
        'gpt-image-2-af': 'GPT Image 2(AnyFast)',
        'gemini-3-pro': 'NanoBanana Pro(AnyFast)',
        'gemini-3.1-fl': 'NanoBanana2(AnyFast)',
        'nano-ace': 'Nano(Ace)',
    };
    return map[apiType] || apiType;
}
