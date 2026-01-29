import { defineStore } from 'pinia';
import request from '@/utils/request';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || '{}'),
  }),
  actions: {
    // 登录动作
    async login(loginForm: any) {
      try {
        // 调用后端接口
        const res: any = await request.post('/auth/login', loginForm);
        
        // 假设后端返回结构: { message: "...", data: { token: "...", userInfo: {...} } }
        const { token, userInfo } = res.data; 

        // 保存状态
        this.token = token;
        this.userInfo = userInfo;
        
        // 持久化到 LocalStorage
        localStorage.setItem('token', token);
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
        
        return true;
      } catch (error) {
        return false;
      }
    },
    // 登出动作
    logout() {
      this.token = '';
      this.userInfo = {};
      localStorage.removeItem('token');
      localStorage.removeItem('userInfo');
    }
  }
});