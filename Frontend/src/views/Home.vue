<template>
    <div style="padding: 20px;">
      <h1>工作台</h1>
      <p>欢迎回来，{{ userStore.userInfo.username }} ({{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }})</p>
      <el-button type="danger" @click="handleLogout">退出登录</el-button>
    </div>
  </template>
  
  <script setup lang="ts">
  import { useUserStore } from '../store/user';
  import { useRouter } from 'vue-router';
  
  const userStore = useUserStore();
  const router = useRouter();
  
  const handleLogout = () => {
    userStore.logout();
    router.push('/login');
  };
  </script>