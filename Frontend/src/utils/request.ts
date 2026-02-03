import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import router from '@/router';

// 创建 axios 实例
const service = axios.create({
  baseURL: '/api', // 走 vite 代理，指向 http://localhost:3000/api
  timeout: 120000, // 图片生成可能需要较长时间，设置为120秒
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

// 响应拦截器：统一处理错误和Token刷新
service.interceptors.response.use(
  (response) => {
    // 后端返回格式通常是 { code, message, data } 或直接数据
    return response.data;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
    const userStore = useUserStore();
    const msg = (error.response?.data as any)?.message || '请求失败';

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
    } else if (error.response?.status !== 401) {
      // 非401错误，显示错误消息
      ElMessage.error(msg);
    }

    return Promise.reject(error);
  }
);

export default service;