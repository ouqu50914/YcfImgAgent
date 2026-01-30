<template>
    <div style="padding: 20px;">
      <h1>工作台</h1>
      <p>欢迎回来，{{ userStore.userInfo.username }} ({{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }})</p>
      
      <div style="margin: 20px 0;">
        <el-button type="primary" @click="router.push('/workflow')">工作流编辑器</el-button>
        <el-button @click="router.push('/profile')">个人中心</el-button>
        <el-button v-if="userStore.userInfo.role === 1" type="warning" @click="router.push('/admin')">管理后台</el-button>
        <el-button type="danger" @click="handleLogout">退出登录</el-button>
      </div>
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