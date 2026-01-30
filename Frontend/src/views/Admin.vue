<template>
  <div class="admin-container">
    <el-tabs v-model="activeTab" type="border-card">
      <!-- 用户管理 -->
      <el-tab-pane label="用户管理" name="users">
        <div class="toolbar">
          <el-button type="primary" @click="showCreateDialog = true">新增用户</el-button>
          <el-input
            v-model="userSearchForm.username"
            placeholder="搜索用户名"
            style="width: 200px; margin-left: 10px"
            clearable
            @clear="loadUserList"
          />
          <el-select
            v-model="userSearchForm.status"
            placeholder="状态筛选"
            style="width: 150px; margin-left: 10px"
            clearable
            @change="loadUserList"
          >
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
          <el-button @click="loadUserList" style="margin-left: 10px">刷新</el-button>
        </div>

        <el-table :data="userList" border style="margin-top: 20px">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="username" label="用户名" />
          <el-table-column prop="role_id" label="角色" width="120">
            <template #default="{ row }">
              <el-tag :type="row.role_id === 1 ? 'danger' : 'primary'">
                {{ row.role_id === 1 ? '超级管理员' : '普通用户' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'danger'">
                {{ row.status === 1 ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="180" />
          <el-table-column label="操作" width="300" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="viewUserStats(row.id)">统计</el-button>
              <el-button size="small" @click="showResetPasswordDialogHandler(row)">重置密码</el-button>
              <el-button size="small" @click="editUser(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteUserHandler(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="userPagination.page"
          v-model:page-size="userPagination.pageSize"
          :total="userPagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadUserList"
          @current-change="loadUserList"
          style="margin-top: 20px"
        />
      </el-tab-pane>

      <!-- 日志查看 -->
      <el-tab-pane label="操作日志" name="logs">
        <div class="toolbar">
          <el-date-picker
            v-model="logDateRange"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="loadLogs"
          />
          <el-select
            v-model="logFilters.operationType"
            placeholder="操作类型"
            style="width: 150px; margin-left: 10px"
            clearable
            @change="loadLogs"
          >
            <el-option label="登录" value="login" />
            <el-option label="生图" value="generate" />
            <el-option label="放大" value="upscale" />
            <el-option label="扩展" value="extend" />
          </el-select>
          <el-select
            v-model="logFilters.apiType"
            placeholder="API类型"
            style="width: 150px; margin-left: 10px"
            clearable
            @change="loadLogs"
          >
            <el-option label="即梦AI" value="dream" />
            <el-option label="Nano" value="nano" />
          </el-select>
          <el-button @click="loadLogs" style="margin-left: 10px">刷新</el-button>
        </div>

        <el-table :data="logList" border style="margin-top: 20px">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="user_id" label="用户ID" width="100" />
          <el-table-column prop="operation_type" label="操作类型" width="120" />
          <el-table-column prop="api_type" label="API类型" width="100" />
          <el-table-column prop="ip_address" label="IP地址" width="150" />
          <el-table-column prop="created_at" label="时间" width="180" />
          <el-table-column prop="details" label="详情">
            <template #default="{ row }">
              <el-popover placement="top" width="300" trigger="hover">
                <template #reference>
                  <el-button size="small" text>查看详情</el-button>
                </template>
                <pre style="max-height: 200px; overflow: auto">{{ JSON.stringify(row.details, null, 2) }}</pre>
              </el-popover>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="logPagination.page"
          v-model:page-size="logPagination.pageSize"
          :total="logPagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadLogs"
          @current-change="loadLogs"
          style="margin-top: 20px"
        />
      </el-tab-pane>

      <!-- API配置 -->
      <el-tab-pane label="API配置" name="configs">
        <el-table :data="apiConfigs" border>
          <el-table-column prop="api_type" label="API类型" width="120" />
          <el-table-column prop="api_url" label="API地址" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-switch
                v-model="row.status"
                :active-value="1"
                :inactive-value="0"
                @change="updateApiConfigStatus(row.api_type, row.status)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="user_daily_limit" label="每日限额" width="120">
            <template #default="{ row }">
              <el-input-number
                v-model="row.user_daily_limit"
                :min="1"
                :max="1000"
                @change="updateApiConfigLimit(row.api_type, row.user_daily_limit)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="used_quota" label="已用额度" width="120" />
          <el-table-column prop="last_sync_time" label="最后同步" width="180" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 创建用户对话框 -->
    <el-dialog v-model="showCreateDialog" title="新增用户" width="500px">
      <el-form :model="createUserForm" :rules="createUserRules" ref="createUserFormRef" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createUserForm.username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createUserForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色" prop="role_id">
          <el-select v-model="createUserForm.role_id">
            <el-option label="普通用户" :value="2" />
            <el-option label="超级管理员" :value="1" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateUser">确定</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog v-model="showResetPasswordDialog" title="重置密码" width="400px">
      <el-form :model="resetPasswordForm" :rules="resetPasswordRules" ref="resetPasswordFormRef" label-width="100px">
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="resetPasswordForm.newPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetPasswordDialog = false">取消</el-button>
        <el-button type="primary" @click="handleResetPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import {
  getUserList,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  getUserStats,
  getOperationLogs,
  getApiConfigs,
  updateApiConfig
} from '@/api/admin';

const activeTab = ref('users');

// 用户管理
const userList = ref([]);
const userSearchForm = reactive({ username: '', status: undefined });
const userPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const showCreateDialog = ref(false);
const createUserForm = reactive({ username: '', password: '', role_id: 2 });
const createUserFormRef = ref<FormInstance>();
const createUserRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

const loadUserList = async () => {
  try {
    const res: any = await getUserList({
      page: userPagination.page,
      pageSize: userPagination.pageSize,
      ...userSearchForm
    });
    userList.value = res.data.users;
    userPagination.total = res.data.total;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

const handleCreateUser = async () => {
  if (!createUserFormRef.value) return;
  await createUserFormRef.value.validate(async (valid) => {
    if (valid) {
      try {
        await createUser(createUserForm);
        ElMessage.success('创建成功');
        showCreateDialog.value = false;
        createUserForm.username = '';
        createUserForm.password = '';
        createUserForm.role_id = 2;
        loadUserList();
      } catch (error: any) {
        ElMessage.error(error.message || '创建失败');
      }
    }
  });
};

const editUser = async (user: any) => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新用户名', '编辑用户', {
      inputValue: user.username
    });
    await updateUser(user.id, { username: value });
    ElMessage.success('更新成功');
    loadUserList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '更新失败');
    }
  }
};

const showResetPasswordDialog = ref(false);
const resetPasswordForm = reactive({ userId: 0, newPassword: '' });
const resetPasswordFormRef = ref<FormInstance>();
const resetPasswordRules = {
  newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }]
};

const showResetPasswordDialogHandler = (user: any) => {
  resetPasswordForm.userId = user.id;
  resetPasswordForm.newPassword = '';
  showResetPasswordDialog.value = true;
};

const handleResetPassword = async () => {
  if (!resetPasswordFormRef.value) return;
  await resetPasswordFormRef.value.validate(async (valid) => {
    if (valid) {
      try {
        await resetPassword(resetPasswordForm.userId, resetPasswordForm.newPassword);
        ElMessage.success('密码重置成功');
        showResetPasswordDialog.value = false;
      } catch (error: any) {
        ElMessage.error(error.message || '重置失败');
      }
    }
  });
};

const deleteUserHandler = async (userId: number) => {
  try {
    await ElMessageBox.confirm('确定要删除该用户吗？', '提示', { type: 'warning' });
    await deleteUser(userId);
    ElMessage.success('删除成功');
    loadUserList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
};

const viewUserStats = async (userId: number) => {
  try {
    const res: any = await getUserStats(userId);
    ElMessageBox.alert(JSON.stringify(res.data, null, 2), '用户统计', { type: 'info' });
  } catch (error: any) {
    ElMessage.error(error.message || '获取失败');
  }
};

// 日志查看
const logList = ref([]);
const logDateRange = ref<[Date, Date] | null>(null);
const logFilters = reactive({ operationType: '', apiType: '' });
const logPagination = reactive({ page: 1, pageSize: 20, total: 0 });

const loadLogs = async () => {
  try {
    const params: any = {
      page: logPagination.page,
      pageSize: logPagination.pageSize,
      ...logFilters
    };
    if (logDateRange.value) {
      params.startDate = logDateRange.value[0].toISOString();
      params.endDate = logDateRange.value[1].toISOString();
    }
    const res: any = await getOperationLogs(params);
    logList.value = res.data.logs;
    logPagination.total = res.data.total;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

// API配置
const apiConfigs = ref([]);

const loadApiConfigs = async () => {
  try {
    const res: any = await getApiConfigs();
    apiConfigs.value = res.data;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

const updateApiConfigStatus = async (apiType: string, status: number) => {
  try {
    await updateApiConfig(apiType, { status });
    ElMessage.success('更新成功');
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败');
    loadApiConfigs();
  }
};

const updateApiConfigLimit = async (apiType: string, limit: number) => {
  try {
    await updateApiConfig(apiType, { user_daily_limit: limit });
    ElMessage.success('更新成功');
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败');
    loadApiConfigs();
  }
};

onMounted(() => {
  loadUserList();
  loadLogs();
  loadApiConfigs();
});
</script>

<style scoped>
.admin-container {
  padding: 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}
</style>
