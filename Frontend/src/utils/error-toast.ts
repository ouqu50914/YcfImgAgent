import { ElMessage } from 'element-plus';
import { translateErrorMessage } from '@/api/prompt';

type ErrorToastOptions = {
  fallbackMessage?: string;
};

type CacheEntry = {
  translated: string;
  expiresAt: number;
};

const CACHE_KEY = 'error-toast-translation-cache-v3';
const CACHE_LIMIT = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TRANSLATE_TIMEOUT_MS = 30000;
const LONG_MESSAGE_TRANSLATE_TIMEOUT_MS = 90000;

const translationCache = new Map<string, CacheEntry>();
const inflightTranslations = new Map<string, Promise<string>>();

let hasPatched = false;
let rawErrorFn: typeof ElMessage.error | null = null;
let translatingToastHandler: { close?: () => void } | null = null;

const hasCjk = (text: string) => /[\u4e00-\u9fa5]/.test(text);
const hasLongAsciiWord = (text: string) => /[A-Za-z]{3,}/.test(text);

const normalizeErrorMessage = (message: string) => {
  return message
    .trim()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{uuid}')
    .replace(/\b0x[0-9a-f]+\b/gi, '{hex}')
    .replace(/\b\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?\b/gi, '{datetime}')
    .replace(/\b(request|trace|task|job|video|image|file|node|workflow|session)[-_ ]?id[:= ]+[a-z0-9_-]+\b/gi, '$1_id={id}')
    .replace(/\b\d+\b/g, '{n}')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const looksLikeIncompleteTranslation = (original: string, translated: string) => {
  const o = original.trim();
  const t = translated.trim();
  if (!o || !t) return true;
  if (o.length >= 120 && t.length < Math.floor(o.length * 0.45)) return true;
  return false;
};

const toDisplayMessage = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in (value as Record<string, unknown>)) {
    const msg = (value as Record<string, unknown>).message;
    return typeof msg === 'string' ? msg : '';
  }
  return '';
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TRANSLATE_TIMEOUT')), ms)),
  ]);
};

const trimCacheIfNeeded = () => {
  while (translationCache.size > CACHE_LIMIT) {
    const firstKey = translationCache.keys().next().value;
    if (!firstKey) break;
    translationCache.delete(firstKey);
  }
};

const loadCacheFromStorage = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    Object.entries(parsed).forEach(([key, value]) => {
      if (!value || typeof value.translated !== 'string' || typeof value.expiresAt !== 'number') return;
      if (value.expiresAt <= now) return;
      translationCache.set(key, value);
    });
    trimCacheIfNeeded();
  } catch {
    // ignore cache corruption
  }
};

const persistCacheToStorage = () => {
  try {
    const obj: Record<string, CacheEntry> = {};
    translationCache.forEach((value, key) => {
      obj[key] = value;
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
};

const getFromCache = (key: string) => {
  const entry = translationCache.get(key);
  if (!entry) return '';
  if (entry.expiresAt <= Date.now()) {
    translationCache.delete(key);
    return '';
  }
  return entry.translated;
};

const setToCache = (key: string, translated: string) => {
  translationCache.set(key, {
    translated,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  trimCacheIfNeeded();
  persistCacheToStorage();
};

export const translateErrorText = async (rawMessage: unknown, fallbackMessage = '请求失败，请稍后重试') => {
  const message = toDisplayMessage(rawMessage).trim() || fallbackMessage;
  if (!message) return fallbackMessage;

  // 纯中文（无明显英文技术词）时，不重复翻译。
  if (hasCjk(message) && !hasLongAsciiWord(message)) {
    return message;
  }

  const key = normalizeErrorMessage(message);
  if (!key) return message;

  const cached = getFromCache(key);
  if (cached) return cached;

  const inflight = inflightTranslations.get(key);
  if (inflight) return await inflight;

  const task = (async () => {
    console.log('[ErrorToast] translate start', {
      key,
      preview: message.slice(0, 220),
    });
    const timeoutMs = message.length > 160 ? LONG_MESSAGE_TRANSLATE_TIMEOUT_MS : TRANSLATE_TIMEOUT_MS;
    const res = await withTimeout(
      translateErrorMessage({ message }),
      timeoutMs
    ) as { data?: { translated?: string } };
    const translated = res?.data?.translated?.trim() || '';
    console.log('[ErrorToast] translate response', {
      key,
      translated_preview: translated.slice(0, 220),
      non_empty: !!translated,
    });
    // 避免把疑似截断的翻译缓存污染后续结果。
    if (translated && !looksLikeIncompleteTranslation(message, translated)) {
      setToCache(key, translated);
      return translated;
    }
    if (translated) {
      console.warn('[ErrorToast] incomplete translation detected, skip cache', {
        key,
        original_length: message.length,
        translated_length: translated.length,
      });
      return translated;
    }
    return message;
  })();

  inflightTranslations.set(key, task);
  try {
    return await task;
  } finally {
    inflightTranslations.delete(key);
  }
};

const showPersistentError = (message: string) => {
  console.log('[ErrorToast] final shown message', {
    preview: message.slice(0, 260),
    length: message.length,
  });
  const errorFn = rawErrorFn ?? ElMessage.error;
  errorFn({
    message,
    duration: 0,
    showClose: true,
  } as any);
};

const showTranslatingToast = () => {
  const errorFn = rawErrorFn ?? ElMessage.error;
  if (translatingToastHandler && typeof translatingToastHandler.close === 'function') {
    translatingToastHandler.close();
  }
  translatingToastHandler = errorFn({
    message: '错误信息翻译中...',
    duration: 0,
    showClose: true,
  } as any) as unknown as { close?: () => void };
};

const closeTranslatingToast = () => {
  if (translatingToastHandler && typeof translatingToastHandler.close === 'function') {
    translatingToastHandler.close();
  }
  translatingToastHandler = null;
};

export const showTranslatedErrorToast = async (rawMessage: unknown, options?: ErrorToastOptions) => {
  const fallback = options?.fallbackMessage || '请求失败，请稍后重试';
  const originalMessage = toDisplayMessage(rawMessage).trim() || fallback;
  const shouldTranslate = hasLongAsciiWord(originalMessage);

  if (shouldTranslate) {
    showTranslatingToast();
  }
  try {
    const translated = await translateErrorText(rawMessage, fallback);
    console.log('[ErrorToast] translated result selected', {
      original_preview: toDisplayMessage(rawMessage).slice(0, 260),
      translated_preview: (translated || fallback).slice(0, 260),
    });
    closeTranslatingToast();
    showPersistentError(translated || fallback);
  } catch (error) {
    console.warn('[ErrorToast] translation failed, fallback to original', {
      reason: (error as Error)?.message || String(error),
      original_preview: toDisplayMessage(rawMessage).slice(0, 260),
    });
    closeTranslatingToast();
    showPersistentError(originalMessage);
  }
};

export const installErrorToastInterceptor = () => {
  if (hasPatched) return;
  hasPatched = true;

  loadCacheFromStorage();

  rawErrorFn = ElMessage.error.bind(ElMessage) as typeof ElMessage.error;
  (ElMessage as any).error = (arg: unknown, ...rest: unknown[]) => {
    if (rest.length > 0) {
      void showTranslatedErrorToast(toDisplayMessage(arg)).catch(() => undefined);
      return;
    }
    void showTranslatedErrorToast(arg).catch(() => undefined);
  };
};
