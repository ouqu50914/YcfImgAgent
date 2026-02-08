<template>
  <div class="admin-container">
    <div class="header-section">
      <el-button 
        text 
        :icon="ArrowLeft" 
        @click="router.push('/')"
        class="back-button"
      >
        返回
      </el-button>
      <h1 class="page-title">管理后台</h1>
    </div>
    
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
          <el-table-column prop="credits" label="积分" width="100">
            <template #default="{ row }">
              <span v-if="row.role_id === 1">—</span>
              <span v-else>{{ row.credits ?? 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="180" />
          <el-table-column label="操作" width="360" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="viewUserStats(row.id)">统计</el-button>
              <el-button size="small" @click="editCreditsHandler(row)" v-if="row.role_id !== 1">积分</el-button>
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

      <!-- 积分申请 -->
      <el-tab-pane label="积分申请" name="creditApplications">
        <div class="toolbar">
          <el-select
            v-model="creditAppStatusFilter"
            placeholder="状态筛选"
            style="width: 150px"
            clearable
            @change="loadCreditApplications"
          >
            <el-option label="待处理" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
          <el-button @click="loadCreditApplications" style="margin-left: 10px">刷新</el-button>
        </div>

        <el-table :data="creditApplications" border style="margin-top: 20px">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="user_id" label="用户ID" width="100" />
          <el-table-column prop="username" label="用户名" width="120" />
          <el-table-column prop="amount" label="申请积分" width="100" />
          <el-table-column prop="reason" label="申请原因" min-width="150" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'">
                {{ row.status === 'pending' ? '待处理' : row.status === 'approved' ? '已通过' : '已驳回' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="申请时间" width="180" />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-button size="small" type="success" @click="approveCreditAppHandler(row)">通过</el-button>
                <el-button size="small" type="danger" @click="rejectCreditAppHandler(row)">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
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

      <!-- 分类管理 -->
      <el-tab-pane label="分类管理" name="categories">
        <div class="toolbar">
          <el-button type="primary" @click="showCreateCategoryDialog = true">新增分类</el-button>
          <el-button @click="loadCategories" style="margin-left: 10px">刷新</el-button>
        </div>

        <el-table :data="categoryList" border style="margin-top: 20px">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="name" label="分类名称" />
          <el-table-column prop="code" label="分类标识" />
          <el-table-column prop="description" label="描述" />
          <el-table-column prop="sort_order" label="排序" width="100" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'danger'">
                {{ row.status === 1 ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="editCategory(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteCategoryHandler(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
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

      <!-- 系统配置 -->
      <el-tab-pane label="系统配置" name="system">
        <div class="toolbar">
          <el-form :inline="false" label-width="120px" style="max-width: 640px">
            <el-form-item label="操作手册链接">
              <el-input
                v-model="helpDocUrlForm.url"
                placeholder="请输入腾讯文档阅读链接，例如：https://docs.qq.com/..."
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="handleSaveHelpDocUrl" :loading="savingHelpDocUrl">
                保存
              </el-button>
            </el-form-item>
            <el-form-item>
              <div style="font-size: 12px; color: #909399;">
                小提示：建议使用腾讯文档的阅读链接，修改后左侧“操作手册”入口将打开该地址。
              </div>
            </el-form-item>
          </el-form>
        </div>
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

    <!-- 创建/编辑分类对话框 -->
    <el-dialog 
      v-model="showCreateCategoryDialog" 
      :title="editingCategory ? '编辑分类' : '新增分类'" 
      width="500px"
      @close="() => { editingCategory = null; categoryForm.name = ''; categoryForm.code = ''; categoryForm.description = ''; categoryForm.sort_order = 0; categoryForm.status = 1; }"
    >
      <el-form :model="categoryForm" :rules="categoryRules" ref="categoryFormRef" label-width="100px">
        <el-form-item label="分类名称" prop="name">
          <el-input v-model="categoryForm.name" placeholder="请输入分类名称" />
        </el-form-item>
        <el-form-item label="分类标识" prop="code">
          <el-input v-model="categoryForm.code" placeholder="请输入分类标识（英文，如：brand）" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="categoryForm.description" type="textarea" :rows="3" placeholder="请输入分类描述（可选）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="categoryForm.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="categoryForm.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateCategoryDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSaveCategory">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑积分对话框 -->
    <el-dialog v-model="showEditCreditsDialog" title="编辑积分" width="400px">
      <el-form label-width="80px">
        <el-form-item label="用户">
          <span>{{ editCreditsForm.username }}</span>
        </el-form-item>
        <el-form-item label="积分数量">
          <el-input-number v-model="editCreditsForm.credits" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCreditsDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateCredits">确定</el-button>
      </template>
    </el-dialog>

    <!-- 用户统计对话框 -->
    <el-dialog v-model="showUserStatsDialog" title="用户统计" width="560px" @opened="loadUserStatsData">
      <div class="stats-filters" v-if="statsUserId">
        <el-date-picker
          v-model="statsDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
        />
        <el-select v-model="statsApiType" placeholder="模型筛选" style="width: 120px; margin-left: 10px" clearable>
          <el-option label="即梦" value="dream" />
          <el-option label="Nano" value="nano" />
        </el-select>
        <el-button type="primary" @click="loadUserStatsData" style="margin-left: 10px">查询</el-button>
      </div>
      <div class="stats-content" v-if="userStatsData">
        <div class="stats-summary">
          <div class="stats-item">
            <span class="stats-label">可用积分</span>
            <span class="stats-value">{{ userStatsData.user?.credits ?? 0 }}</span>
          </div>
          <div class="stats-item">
            <span class="stats-label">使用总积分</span>
            <span class="stats-value highlight">{{ userStatsData.totalCreditsUsed ?? 0 }}</span>
          </div>
          <div class="stats-item">
            <span class="stats-label">项目数</span>
            <span class="stats-value">{{ userStatsData.projectCount ?? 0 }}</span>
          </div>
        </div>
        <div class="stats-section" v-if="userStatsData.creditsByApiType?.length">
          <div class="stats-section-title">按模型统计（积分消耗）</div>
          <el-table :data="userStatsData.creditsByApiType" size="small" border>
            <el-table-column prop="apiType" label="模型" width="120">
              <template #default="{ row }">{{ row.apiType === 'dream' ? '即梦' : row.apiType === 'nano' ? 'Nano' : row.apiType }}</template>
            </el-table-column>
            <el-table-column prop="total" label="消耗积分" />
          </el-table>
        </div>
        <div class="stats-meta">
          <span>最后登录：{{ userStatsData.lastLoginTime ? new Date(userStatsData.lastLoginTime).toLocaleString() : '—' }}</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="showUserStatsDialog = false">关闭</el-button>
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
import { ref, reactive, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
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
  updateApiConfig,
  getCreditApplications,
  approveCreditApplication,
  rejectCreditApplication,
  updateUserCredits,
  getHelpDocUrl,
  updateHelpDocUrl
} from '@/api/admin';
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type WorkflowCategory
} from '@/api/category';

const router = useRouter();

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

const showUserStatsDialog = ref(false);
const statsUserId = ref<number | null>(null);
const statsDateRange = ref<[string, string] | null>(null);
const statsApiType = ref('');
const userStatsData = ref<any>(null);

const viewUserStats = (userId: number) => {
  statsUserId.value = userId;
  statsDateRange.value = null;
  statsApiType.value = '';
  userStatsData.value = null;
  showUserStatsDialog.value = true;
};

const loadUserStatsData = async () => {
  if (!statsUserId.value) return;
  try {
    const params: { startDate?: string; endDate?: string; apiType?: string } = {};
    if (statsDateRange.value && statsDateRange.value.length === 2) {
      params.startDate = statsDateRange.value[0];
      params.endDate = statsDateRange.value[1];
    }
    if (statsApiType.value) params.apiType = statsApiType.value;
    const res: any = await getUserStats(statsUserId.value, params);
    userStatsData.value = res.data;
  } catch (error: any) {
    ElMessage.error(error.message || '获取失败');
  }
};

// 积分管理
const showEditCreditsDialog = ref(false);
const editCreditsForm = reactive<{ userId: number; username: string; credits: number }>({ userId: 0, username: '', credits: 0 });

const editCreditsHandler = (user: any) => {
  editCreditsForm.userId = user.id;
  editCreditsForm.username = user.username;
  editCreditsForm.credits = user.credits ?? 0;
  showEditCreditsDialog.value = true;
};

const handleUpdateCredits = async () => {
  try {
    await updateUserCredits(editCreditsForm.userId, editCreditsForm.credits);
    ElMessage.success('积分更新成功');
    showEditCreditsDialog.value = false;
    loadUserList();
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败');
  }
};

// 积分申请
const creditApplications = ref<any[]>([]);
const creditAppStatusFilter = ref('');

const loadCreditApplications = async () => {
  try {
    const res: any = await getCreditApplications(creditAppStatusFilter.value || undefined);
    creditApplications.value = res.data || [];
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

const approveCreditAppHandler = async (row: any) => {
  try {
    const { value } = await ElMessageBox.prompt('确认通过的积分数量（可修改）', '通过申请', {
      inputValue: String(row.amount),
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入正整数'
    });
    const amount = parseInt(value, 10);
    if (isNaN(amount) || amount < 1) {
      ElMessage.error('积分数量无效');
      return;
    }
    await approveCreditApplication(row.id, { amount });
    ElMessage.success('已通过');
    loadCreditApplications();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '操作失败');
    }
  }
};

const rejectCreditAppHandler = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定驳回该申请？', '驳回', { type: 'warning' });
    await rejectCreditApplication(row.id);
    ElMessage.success('已驳回');
    loadCreditApplications();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '操作失败');
    }
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

// 系统配置 - 操作手册链接
const helpDocUrlForm = reactive<{ url: string }>({ url: '' });
const savingHelpDocUrl = ref(false);

const loadHelpDocUrl = async () => {
  try {
    const res: any = await getHelpDocUrl();
    helpDocUrlForm.url = res.url || '';
  } catch (error: any) {
    ElMessage.error(error.message || '加载操作手册链接失败');
  }
};

const handleSaveHelpDocUrl = async () => {
  if (!helpDocUrlForm.url.trim()) {
    ElMessage.warning('请输入文档链接');
    return;
  }
  savingHelpDocUrl.value = true;
  try {
    await updateHelpDocUrl(helpDocUrlForm.url.trim());
    ElMessage.success('已更新操作手册链接');
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    savingHelpDocUrl.value = false;
  }
};

// 分类管理
const categoryList = ref<WorkflowCategory[]>([]);
const showCreateCategoryDialog = ref(false);
const editingCategory = ref<WorkflowCategory | null>(null);
const categoryForm = reactive({
  name: '',
  code: '',
  description: '',
  sort_order: 0,
  status: 1
});
const categoryFormRef = ref<FormInstance>();
const categoryRules = {
  name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入分类标识', trigger: 'blur' },
    { pattern: /^[a-z0-9_]+$/, message: '分类标识只能包含小写字母、数字和下划线', trigger: 'blur' }
  ]
};

const loadCategories = async () => {
  try {
    const res: any = await getAllCategories();
    categoryList.value = res.data;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

const handleSaveCategory = async () => {
  if (!categoryFormRef.value) return;
  await categoryFormRef.value.validate(async (valid) => {
    if (valid) {
      try {
        if (editingCategory.value) {
          await updateCategory(editingCategory.value.id, categoryForm);
          ElMessage.success('更新成功');
        } else {
          await createCategory(categoryForm);
          ElMessage.success('创建成功');
        }
        showCreateCategoryDialog.value = false;
        editingCategory.value = null;
        categoryForm.name = '';
        categoryForm.code = '';
        categoryForm.description = '';
        categoryForm.sort_order = 0;
        categoryForm.status = 1;
        loadCategories();
      } catch (error: any) {
        ElMessage.error(error.message || '操作失败');
      }
    }
  });
};

const editCategory = (category: WorkflowCategory) => {
  editingCategory.value = category;
  categoryForm.name = category.name;
  categoryForm.code = category.code;
  categoryForm.description = category.description || '';
  categoryForm.sort_order = category.sort_order;
  categoryForm.status = category.status;
  showCreateCategoryDialog.value = true;
};

const deleteCategoryHandler = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除该分类吗？', '提示', { type: 'warning' });
    await deleteCategory(id);
    ElMessage.success('删除成功');
    loadCategories();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
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

watch(activeTab, (tab) => {
  if (tab === 'creditApplications') loadCreditApplications();
  if (tab === 'system') loadHelpDocUrl();
});

onMounted(() => {
  loadUserList();
  loadLogs();
  loadApiConfigs();
  loadCategories();
});
</script>

<style scoped>
.admin-container {
  height: 100vh;
  width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
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

.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.stats-filters {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.stats-content {
  min-height: 120px;
}

.stats-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
}

.stats-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stats-label {
  font-size: 12px;
  color: #909399;
}

.stats-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.stats-value.highlight {
  color: #e6a23c;
}

.stats-section {
  margin-bottom: 16px;
}

.stats-section-title {
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}

.stats-meta {
  font-size: 12px;
  color: #909399;
}
</style>
