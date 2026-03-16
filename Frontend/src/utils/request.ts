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
};

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
      if (backendCode && errorMessages[backendCode]) {
        ElMessage.error(errorMessages[backendCode]);
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