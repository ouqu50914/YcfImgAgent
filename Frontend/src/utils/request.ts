import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import router from '@/router';

// 创建 axios 实例
const service = axios.create({
  baseURL: '/api', // 走 vite 代理，指向 http://localhost:3000/api
  timeout: 1800000, // 统一超时时间为30分钟
});

// 存储待重试的请求
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

// 处理队列中的请求
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// 请求拦截器：每次请求自动带 Token
service.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 错误码与中文提示文案（toast 用，console 打原始错误）
const errorMessages: Record<string, string> = {
  // 上传相关
  UPLOAD_FILE_TOO_LARGE: '单张图片大小不能超过 10MB，请压缩后再试。',
  UPLOAD_FILE_TYPE_NOT_ALLOWED: '仅支持 jpg、png、gif、webp 等常见图片格式。',
  UPLOAD_FILE_COUNT_LIMIT: '一次上传的图片数量超出限制，请分批上传。',
  UPLOAD_AUTH_REQUIRED: '请先登录后再上传图片。',
  UPLOAD_ERROR: '图片上传失败，请检查文件后重试。',
  UPLOAD_UNKNOWN_ERROR: '图片上传失败，请稍后重试或联系客服。',

  // 账户相关
  ACCOUNT_IN_ARREARS: '账户余额不足，请先充值后再使用。',

  // 配额/限流相关（部分后端未返回 code 时会走关键字识别）
  QUOTA_EXCEEDED: '模型配额不足或已耗尽，请稍后重试或联系管理员扩容/充值。',
  UPSTREAM_BALANCE_NOT_ENOUGH: '上游模型账户余额不足，请联系管理员充值后再试。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
};

const normalizeText = (v: unknown) => (v == null ? '' : String(v));

function guessFriendlyMessage(params: {
  status?: number;
  backendCode?: string;
  backendMsg?: string;
  retryAfter?: number;
}) {
  const status = params.status;
  const code = normalizeText(params.backendCode).trim();
  const msg = normalizeText(params.backendMsg).trim();
  const lower = msg.toLowerCase();

  // 1) 明确 code 优先
  if (code && errorMessages[code]) return errorMessages[code];

  // 2) HTTP 429：限流 或 上游配额/余额不足（部分第三方用 429 表示）
  if (status === 429) {
    if (
      lower.includes('balance not enough') ||
      lower.includes('insufficient balance') ||
      lower.includes('insufficient_quota') ||
      lower.includes('quota') && lower.includes('insufficient') ||
      lower.includes('credits') && lower.includes('insufficient')
    ) {
      return errorMessages.UPSTREAM_BALANCE_NOT_ENOUGH;
    }
    if (typeof params.retryAfter === 'number' && params.retryAfter > 0) {
      return `请求过于频繁，请${params.retryAfter}秒后再试`;
    }
    return errorMessages.RATE_LIMITED;
  }

  // 3) 常见“配额不足/额度用尽”关键字（英文为主）
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('exceeded quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('resource exhausted') ||
    lower.includes('billing') && lower.includes('quota')
  ) {
    // 如果是明显限流，单独提示
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return errorMessages.RATE_LIMITED;
    }
    return errorMessages.QUOTA_EXCEEDED;
  }

  // 4) 上游余额不足关键字
  if (
    lower.includes('balance not enough') ||
    lower.includes('insufficient balance') ||
    lower.includes('payment required') ||
    lower.includes('not enough balance')
  ) {
    return errorMessages.UPSTREAM_BALANCE_NOT_ENOUGH;
  }

  // 5) 积分不足（后端 credit.service 抛的是中文，这里主要兜英文）
  if (lower.includes('insufficient') && lower.includes('credit')) {
    return errorMessages.ACCOUNT_IN_ARREARS;
  }

  return '';
}

const isUploadRequest = (config?: AxiosRequestConfig) => {
  if (!config || !config.url) return false;
  const url = config.url;
  return url.includes('/image/upload');
};

// 响应拦截器：统一处理错误和Token刷新
service.interceptors.response.use(
  (response) => {
    // 后端返回格式通常是 { code, message, data } 或直接数据
    return response.data;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
    const userStore = useUserStore();
    // 先打印详细错误日志，方便开发排查
    console.error('[HTTP ERROR]', {
      url: originalRequest?.url,
      method: originalRequest?.method,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    const data = (error.response?.data || {}) as any;
    const backendCode: string | undefined = data.code;
    const backendMsg: string | undefined = data.message;
    const isUpload = isUploadRequest(originalRequest);
    const retryAfter: number | undefined = typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
    const fallbackMsg = '请求失败，请稍后重试';

    // 如果是401错误且是token过期
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const errorData = error.response.data as any;
      
      // 如果是token过期，尝试刷新
      if (errorData?.expired || errorData?.code === 'TOKEN_EXPIRED') {
        if (isRefreshing) {
          // 如果正在刷新，将请求加入队列
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              if (originalRequest.headers) {
                originalRequest.headers['Authorization'] = `Bearer ${token}`;
              }
              return service(originalRequest);
            })
            .catch((err) => {
              return Promise.reject(err);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          // 刷新token
          const newToken = await userStore.refreshToken();
          
          // 更新请求头
          if (originalRequest.headers) {
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          }

          // 处理队列中的请求
          processQueue(null, newToken);

          // 重试原始请求
          return service(originalRequest);
        } catch (refreshError) {
          // 刷新失败，处理队列并跳转登录
          processQueue(refreshError, null);
          ElMessage.error('登录已过期，请重新登录');
          userStore.logout();
          router.push('/login');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        // 其他401错误（如无效token），直接跳转登录
        ElMessage.error('登录已过期，请重新登录');
        userStore.logout();
        router.push('/login');
      }
    } else if (error.response?.status === 403 &&
               (backendMsg === '无效的认证令牌' || backendMsg === '未提供认证令牌')) {
      // 403 且是认证相关错误，同样视为登录失效
      ElMessage.error('登录已过期，请重新登录');
      userStore.logout();
      router.push('/login');
    } else if (error.response?.status !== 401) {
      // 非401错误，统一中文错误提示（toast）
      const guessed = guessFriendlyMessage({
        status: error.response?.status,
        backendCode,
        backendMsg,
        retryAfter,
      });
      if (guessed) {
        ElMessage.error(guessed);
      } else if (isUpload && backendMsg) {
        // 上传接口：后端 message 已是中文时可直接展示
        ElMessage.error(backendMsg);
      } else if (backendMsg && /[\u4e00-\u9fa5]/.test(backendMsg)) {
        // 仅当后端 message 含中文时直接展示，避免英文直出
        ElMessage.error(backendMsg);
      } else {
        // 兜底：统一中文文案
        ElMessage.error(fallbackMsg);
      }
    }

    return Promise.reject(error);
  }
);

export default service;