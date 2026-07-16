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
 * 是否像 COS 预签名 URL（带 q-sign，约 1 小时过期，禁止写入工作流持久化字段）
 */
export function isLikelySignedCosUrl(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('q-sign-algorithm') ||
    u.includes('q-signature') ||
    u.includes('x-cos-security-token') ||
    u.includes('sign=') && u.includes('t=')
  );
}

/**
 * 从绝对/相对 URL 中提取稳定的 /uploads/... 路径（去掉签名 query）。
 * 无法识别时原样返回（上游临时 CDN 等）。
 */
export function toPersistableImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  const v = String(url).trim();
  if (!v) return '';
  if (v.startsWith('data:') || v.startsWith('asset://')) return v;

  const stripQuery = (path: string) => path.split('?')[0] || path;

  if (v.startsWith('/uploads/')) return stripQuery(v);
  if (v.startsWith('uploads/')) return stripQuery(`/${v}`);

  try {
    const parsed = new URL(v, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const idx = parsed.pathname.indexOf('/uploads/');
    if (idx >= 0) return stripQuery(parsed.pathname.slice(idx));
  } catch {
    // ignore
  }

  // 已带签名的绝对 URL 且无法抽出 /uploads：不要当持久化地址
  if (isLikelySignedCosUrl(v)) return '';
  return v;
}

/**
 * 将后端返回的 /uploads 相对路径拼成可访问的完整 URL（支持 CDN 域名）
 */
export function getUploadUrl(url: string): string {
  if (!url) return '';
  const v = String(url).trim();
  if (!v) return '';
  // 文档允许 asset:// 素材 ID；音频也可能是 data:base64
  // 这些不应被拼接成 /uploads/ 路径
  if (v.startsWith('asset://')) return v;
  if (v.startsWith('data:')) return v;

  // 绝对 URL：若含 /uploads/，先归一成相对路径再拼当前环境的 UPLOAD_BASE，
  // 避免工作流里写死生成当时的域名/预签名导致日后「加载失败」。
  if (v.startsWith('http://') || v.startsWith('https://')) {
    const persistable = toPersistableImageUrl(v);
    if (persistable.startsWith('/uploads/')) {
      return `${UPLOAD_BASE}${persistable}`;
    }
    return v;
  }

  if (v.startsWith('/uploads/')) {
    return `${UPLOAD_BASE}${v.split('?')[0]}`;
  }
  if (v.startsWith('uploads/')) {
    return `${UPLOAD_BASE}/${(v.split('?')[0] || v)}`;
  }
  const normalizedPath = v.startsWith('/') ? v.slice(1) : v;
  return `${UPLOAD_BASE}/uploads/${normalizedPath}`;
}

/**
 * 展示用：优先稳定路径（original → imageUrl），再拼当前环境可访问地址
 */
export function getDisplayImageUrl(
  imageUrl?: string | null,
  originalImageUrl?: string | null
): string {
  const candidates = [originalImageUrl, imageUrl]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);

  for (const c of candidates) {
    const persistable = toPersistableImageUrl(c);
    if (persistable.startsWith('/uploads/') || persistable.startsWith('data:') || persistable.startsWith('asset://')) {
      return getUploadUrl(persistable);
    }
  }

  for (const c of candidates) {
    if (!isLikelySignedCosUrl(c)) return getUploadUrl(c);
  }

  return candidates[0] ? getUploadUrl(candidates[0]) : '';
}

/**
 * 兼容旧命名：获取完整图片URL
 */
export function getFullImageUrl(url: string): string {
  return getUploadUrl(url);
}
