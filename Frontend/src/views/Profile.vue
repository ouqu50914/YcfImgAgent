<template>
  <div class="profile-container">
    <div class="header-section">
      <el-button 
        text 
        :icon="ArrowLeft" 
        @click="router.push('/')"
        class="back-button"
      >
        返回
      </el-button>
      <h1 class="page-title">个人中心</h1>
    </div>
    
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>个人信息</h2>
        </div>
      </template>

      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="用户名">
          <el-input v-model="userStore.userInfo.username" disabled />
        </el-form-item>

        <el-form-item label="角色">
          <el-tag :type="userStore.userInfo.role === 1 ? 'danger' : 'primary'">
            {{ userStore.userInfo.role === 1 ? '超级管理员' : '普通用户' }}
          </el-tag>
        </el-form-item>

        <el-divider />

        <h3>修改密码</h3>

        <el-form-item label="原密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            placeholder="请输入原密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="请输入新密码（6位以上，包含字母和数字）"
            show-password
          />
        </el-form-item>

        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">
            修改密码
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
import { ArrowLeft } from '@element-plus/icons-vue';
import type { FormInstance } from 'element-plus';
import request from '@/utils/request';

const router = useRouter();

const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
});

const validatePassword = (_rule: any, value: any, callback: any) => {
  if (!value) {
    callback(new Error('请输入新密码'));
  } else if (value.length < 6) {
    callback(new Error('密码长度至少6位'));
  } else if (!/^(?=.*[A-Za-z])(?=.*\d)/.test(value)) {
    callback(new Error('密码需包含字母和数字'));
  } else {
    callback();
  }
};

const validateConfirmPassword = (_rule: any, value: any, callback: any) => {
  if (!value) {
    callback(new Error('请再次输入新密码'));
  } else if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const rules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, validator: validatePassword, trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, validator: validateConfirmPassword, trigger: 'blur' }
  ]
};

const handleSubmit = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (valid) {
      loading.value = true;
      try {
        await request.post('/auth/change-password', {
          oldPassword: form.oldPassword,
          newPassword: form.newPassword
        });
        ElMessage.success('密码修改成功');
        // 清空表单
        form.oldPassword = '';
        form.newPassword = '';
        form.confirmPassword = '';
      } catch (error: any) {
        ElMessage.error(error.message || '密码修改失败');
      } finally {
        loading.value = false;
      }
    }
  });
};
</script>

<style scoped>
.profile-container {
  height: 100vh;
  width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
  box-sizing: border-box;
}

.header-section {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.back-button {
  padding: 8px 12px;
  font-size: 14px;
  color: #606266;
  transition: color 0.2s;
}

.back-button:hover {
  color: #409eff;
}

.card-header h2 {
  margin: 0;
  color: #333;
}

h3 {
  margin: 20px 0 10px 0;
  color: #606266;
}
</style>
