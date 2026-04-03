import { createRouter, createWebHistory } from 'vue-router';
import Login from '@/views/Login.vue';
import Home from '@/views/Home.vue';
import Workflow from '@/views/Workflow.vue';
import Profile from '@/views/Profile.vue';
import Admin from '@/views/Admin.vue';
import WorkflowPlaza from '@/views/WorkflowPlaza.vue';
import SeedanceDemo from '@/views/SeedanceDemo.vue';

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
    meta: { requiresAuth: true }
  },
  {
    path: '/workflow-plaza',
    name: 'WorkflowPlaza',
    component: WorkflowPlaza,
    meta: { requiresAuth: true }
  },
  {
    path: '/seedance-demo',
    name: 'SeedanceDemo',
    component: SeedanceDemo,
    meta: { requiresAuth: true }
  }
];

const router = createRouter({
  history: createWebHistory('/agent'),
  routes
});

// 路由守卫：防止未登录访问首页
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token');
  const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
  
  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else {
    next();
  }
});

export default router;