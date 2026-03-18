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

const UPLOAD_BASE = import.meta.env.VITE_UPLOAD_BASE_URL || window.location.origin;

/**
 * 将后端返回的 /uploads 相对路径拼成可访问的完整 URL（支持 CDN 域名）
 */
export function getUploadUrl(url: string): string {
  if (!url) return '';
  // 文档允许 asset:// 素材 ID；音频也可能是 data:base64
  // 这些不应被拼接成 /uploads/ 路径
  if (url.startsWith('http')) return url;
  if (url.startsWith('asset://')) return url;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('/uploads/')) {
    return `${UPLOAD_BASE}${url}`;
  }
  return `${UPLOAD_BASE}/uploads/${url}`;
}

/**
 * 兼容旧命名：获取完整图片URL
 */
export function getFullImageUrl(url: string): string {
  return getUploadUrl(url);
}
