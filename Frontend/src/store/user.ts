import { defineStore } from 'pinia';
import request from '@/utils/request';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    refreshToken: localStorage.getItem('refreshToken') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || '{}'),
    isRefreshing: false, // 防止并发刷新
  }),
  actions: {
    // 登录动作
    async login(loginForm: any) {
      try {
        // 调用后端接口
        const res: any = await request.post('/auth/login', loginForm);
        
        // 假设后端返回结构: { message: "...", data: { token: "...", refreshToken: "...", userInfo: {...} } }
        const { token, refreshToken, userInfo } = res.data; 

        // 保存状态
        this.token = token;
        this.refreshToken = refreshToken || '';
        this.userInfo = userInfo;
        
        // 持久化到 LocalStorage
        localStorage.setItem('token', token);
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
        
        return true;
      } catch (error) {
        return false;
      }
    },
    // 刷新 Token
    async refreshToken() {
      if (this.isRefreshing) {
        // 如果正在刷新，等待刷新完成
        return new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.isRefreshing) {
              clearInterval(checkInterval);
              resolve(this.token);
            }
          }, 100);
        });
      }

      if (!this.refreshToken) {
        throw new Error('没有 refresh token');
      }

      this.isRefreshing = true;

      try {
        const res: any = await request.post('/auth/refresh-token', {
          refreshToken: this.refreshToken
        });

        const { token, userInfo } = res.data;
        this.token = token;
        this.userInfo = userInfo;
        localStorage.setItem('token', token);
        localStorage.setItem('userInfo', JSON.stringify(userInfo));

        return token;
      } catch (error: any) {
        // 刷新失败，清除所有token，跳转登录
        this.logout();
        throw error;
      } finally {
        this.isRefreshing = false;
      }
    },
    // 登出动作
    async logout() {
      try {
        // 调用后端登出接口（如果已登录）
        if (this.token) {
          await request.post('/auth/logout').catch(() => {
            // 忽略登出失败的错误
          });
        }
      } catch (error) {
        // 忽略错误
      } finally {
        this.token = '';
        this.refreshToken = '';
        this.userInfo = {};
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userInfo');
      }
    }
  }
});