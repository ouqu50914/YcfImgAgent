/**
 * 积分计算规则（与后端 CreditService / nano-credit.util 一致）
 * 即梦 2K/1K/standard = 1/张，即梦 4K = 2/张
 * Nano = 6/次
 * Dream 放大/扩展/拆分/图层分离 = 1
 */
export type CreditOperation = 'generate' | 'upscale' | 'extend' | 'split' | 'layer_split';

type NanoProviderHint = 'ace' | 'anyfast';

function resolveNanoProvider(model?: string, providerHint?: NanoProviderHint): NanoProviderHint {
  if (providerHint === 'ace' || providerHint === 'anyfast') return providerHint;
  if (model?.startsWith('gemini-')) return 'anyfast';
  if (model === 'gpt-image-2-c') return 'anyfast';
  if (model === 'gpt-image-2') return 'ace';
  if (model?.startsWith('nano-banana-')) return 'ace';
  return 'ace';
}

function isGptImage2Model(model?: string): boolean {
  return model === 'gpt-image-2' || model === 'gpt-image-2-c';
}

function calcNanoGenerateCredits(options: {
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
    const perImage =
      model === 'gemini-3-pro-image-preview'
        ? quality === '4K'
          ? 20
          : 15
        : quality === '4K'
          ? 15
          : 11;
    return perImage * count;
  }

  return 6 * count;
}

export function getCreditCost(
  apiType: 'dream' | 'nano' | 'midjourney',
  operation: CreditOperation,
  options?: {
    quality?: string;
    imageCount?: number;
    model?: string;
    providerHint?: 'ace' | 'anyfast';
  }
): number {
  const count = options?.imageCount ?? 1;

  if (apiType === 'nano') {
    return calcNanoGenerateCredits({
      model: options?.model,
      providerHint: options?.providerHint,
      quality: options?.quality,
      imageCount: count,
    });
  }
  if (apiType === 'midjourney') {
    return 6 * count;
  }

  if (operation === 'generate') {
    const quality = options?.quality || '2K';
    const perImage = quality === '4K' ? 2 : 1;
    return perImage * count;
  }

  return 1;
}
