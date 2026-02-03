<template>
    <div class="login-container">
      <el-card class="login-card">
        <template #header>
          <div class="card-header">
            <h2>内部AI生图工具</h2>
          </div>
        </template>
        
        <el-form :model="form" :rules="rules" ref="loginFormRef" label-position="top">
          <el-form-item label="账号" prop="username">
            <el-input v-model="form.username" placeholder="请输入内网账号" />
          </el-form-item>
          
          <el-form-item label="密码" prop="password">
            <el-input 
              v-model="form.password" 
              type="password" 
              placeholder="请输入密码" 
              show-password
              @keyup.enter="handleLogin" 
            />
          </el-form-item>
          
          <el-form-item>
            <el-button type="primary" :loading="loading" class="w-100" @click="handleLogin">
              登录
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, reactive } from 'vue';
  import { useRouter } from 'vue-router';
  import { useUserStore } from '@/store/user';
  import { ElMessage } from 'element-plus';
  import type { FormInstance } from 'element-plus';
  
  const router = useRouter();
  const userStore = useUserStore();
  const loginFormRef = ref<FormInstance>();
  const loading = ref(false);
  
  const form = reactive({
    username: '',
    password: ''
  });
  
  const rules = {
    username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
    password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
  };
  
  const handleLogin = async () => {
    if (!loginFormRef.value) return;
    
    await loginFormRef.value.validate(async (valid) => {
      if (valid) {
        loading.value = true;
        const success = await userStore.login(form);
        loading.value = false;
        
        if (success) {
          ElMessage.success('登录成功');
          router.push('/'); // 跳转到首页
        }
      }
    });
  };
  </script>
  
  <style scoped>
  .login-container {
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f0f2f5;
  }
  
  .login-card {
    width: 400px;
  }
  
  .card-header h2 {
    text-align: center;
    margin: 0;
    color: #333;
  }
  
  .w-100 {
    width: 100%;
  }
  
  .tips {
    margin-top: 20px;
    text-align: center;
    font-size: 12px;
    color: #999;
  }
  </style>