/**
 * 积分计算规则（与后端 CreditService 一致）
 * 即梦 2K/1K/standard = 1/张，即梦 4K = 2/张
 * Nano = 6/次
 * Dream 放大/扩展/拆分/图层分离 = 1
 */
export type CreditOperation = 'generate' | 'upscale' | 'extend' | 'split' | 'layer_split';

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
    const quality = options?.quality === '4K' ? '4K' : '2K';
    const model = options?.model;
    const provider =
      options?.providerHint ||
      (model?.startsWith('gemini-') ? 'anyfast' : undefined) ||
      (model === 'gpt-image-2' ? 'anyfast' : undefined) ||
      (model?.startsWith('nano-banana-') ? 'ace' : undefined) ||
      'ace';

    if (provider === 'anyfast') {
      if (model === 'gpt-image-2') {
        const q = options?.quality === 'high' ? 'high' : options?.quality === 'low' ? 'low' : 'medium';
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
