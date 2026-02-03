/**
 * 图片加载优化工具
 * 支持缩略图预加载和懒加载
 */

/**
 * 生成缩略图URL（如果后端支持）
 */
export function getThumbnailUrl(originalUrl: string, size: number = 200): string {
  if (!originalUrl) return '';
  
  // 如果URL包含查询参数，添加缩略图参数
  const url = new URL(originalUrl, window.location.origin);
  url.searchParams.set('thumbnail', size.toString());
  
  return url.toString();
}

/**
 * 预加载图片
 */
export function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * 懒加载图片（使用Intersection Observer）
 */
export function useLazyImage(element: HTMLElement | null, imageUrl: string, callback: (url: string) => void) {
  if (!element || !imageUrl) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          callback(imageUrl);
          observer.unobserve(entry.target);
        }
      });
    },
    {
      rootMargin: '50px' // 提前50px开始加载
    }
  );

  observer.observe(element);

  return () => {
    observer.disconnect();
  };
}

/**
 * 获取完整图片URL
 */
export function getFullImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) {
    return `${window.location.origin}${url}`;
  }
  return `${window.location.origin}/uploads/${url}`;
}
