import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import Login from '@/views/Login.vue';
import Home from '@/views/Home.vue';
import Workflow from '@/views/Workflow.vue';
import Profile from '@/views/Profile.vue';
import Admin from '@/views/Admin.vue';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login
  },
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { requiresAuth: true } // 标记需要登录
  },
  {
    path: '/workflow',
    name: 'Workflow',
    component: Workflow,
    meta: { requiresAuth: true }
  },
  {
    path: '/profile',
    name: 'Profile',
    component: Profile,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: Admin,
    meta: { requiresAuth: true, requiresAdmin: true }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// 路由守卫：防止未登录访问首页
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token');
  const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
  
  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else if (to.meta.requiresAdmin && userInfo.role !== 1) {
    // 需要管理员权限但当前用户不是管理员
    ElMessage.error('需要超级管理员权限');
    next('/');
  } else {
    next();
  }
});

export default router;