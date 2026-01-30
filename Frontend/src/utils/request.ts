import axios from 'axios';
import { ElMessage } from 'element-plus';

// 创建 axios 实例
const service = axios.create({
  baseURL: '/api', // 走 vite 代理，指向 http://localhost:3000/api
  timeout: 120000, // 图片生成可能需要较长时间，设置为120秒
});

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

// 响应拦截器：统一处理错误
service.interceptors.response.use(
  (response) => {
    // 后端返回格式通常是 { code, message, data } 或直接数据
    // 这里假设后端成功返回 200/201
    return response.data;
  },
  (error) => {
    const msg = error.response?.data?.message || '请求失败';
    
    if (error.response && error.response.status === 401) {
      ElMessage.error('登录已过期，请重新登录');
      localStorage.removeItem('token');
      localStorage.removeItem('userInfo');
      window.location.href = '/login'; // 强制跳转
    } else {
      ElMessage.error(msg);
    }
    return Promise.reject(error);
  }
);

export default service;