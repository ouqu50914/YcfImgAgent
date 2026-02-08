/**
 * 积分计算规则（与后端 CreditService 一致）
 * 即梦 2K/1K/standard = 1/张，即梦 4K = 2/张
 * Nano = 5/次
 * Dream 放大/扩展/拆分/图层分离 = 1
 */
export type CreditOperation = 'generate' | 'upscale' | 'extend' | 'split' | 'layer_split';

export function getCreditCost(
  apiType: 'dream' | 'nano',
  operation: CreditOperation,
  options?: { quality?: string; imageCount?: number }
): number {
  const count = options?.imageCount ?? 1;

  if (apiType === 'nano') {
    return 5 * count;
  }

  if (operation === 'generate') {
    const quality = options?.quality || '2K';
    const perImage = quality === '4K' ? 2 : 1;
    return perImage * count;
  }

  return 1;
}
