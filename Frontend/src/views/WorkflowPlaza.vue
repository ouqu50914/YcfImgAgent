<template>
  <div class="plaza-container">
    <!-- 顶部区域 -->
    <div class="header-section">
      <div class="header-left">
        <el-button 
          :icon="ArrowLeft" 
          circle 
          @click="router.push('/')"
          style="margin-right: 12px;"
        />
        <h1 class="page-title">工作流广场</h1>
      </div>
    </div>

    <!-- 搜索区域 -->
    <div class="search-section">
      <el-input
        v-model="searchForm.keyword"
        placeholder="搜索工作流名称、作者..."
        clearable
        style="width: 300px; margin-right: 12px;"
        @keyup.enter="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select
        v-model="searchForm.sortBy"
        placeholder="排序方式"
        style="width: 150px; margin-right: 12px;"
        @change="handleSearch"
      >
        <el-option label="按时间" value="time" />
        <el-option label="按使用次数" value="usage" />
      </el-select>
      <el-button type="primary" @click="handleSearch">搜索</el-button>
      <el-button @click="handleReset">重置</el-button>
    </div>

    <!-- 工作流列表（瀑布流布局） -->
    <div class="workflow-masonry" v-loading="loading">
      <div
        v-for="template in templates"
        :key="template.id"
        class="workflow-card"
        @click="handleLoadTemplate(template)"
      >
        <div class="card-image">
          <el-image
            v-if="template.cover_image"
            :src="getImageUrl(template.cover_image)"
            fit="cover"
            :lazy="true"
            class="cover-image"
          >
            <template #error>
              <div class="image-placeholder">暂无封面</div>
            </template>
          </el-image>
          <div v-else class="image-placeholder">暂无封面</div>
        </div>
        <div class="card-info">
          <div class="card-title">{{ template.name }}</div>
          <div class="card-meta">
            <span class="author">作者: {{ template.author_name || '未知' }}</span>
            <span class="time">{{ formatTime(template.created_at) }}</span>
          </div>
          <div class="card-stats">
            <span>使用次数: {{ template.usage_count || 0 }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && templates.length === 0" class="empty-state">
      <el-empty description="暂无公开工作流" />
    </div>

    <!-- 分页 -->
    <div class="pagination" v-if="total > 0">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="total"
        :page-sizes="[12, 24, 48]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSearch"
        @current-change="handleSearch"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, Search } from '@element-plus/icons-vue';
import { getPublicTemplates, type WorkflowTemplate } from '@/api/workflow';

const router = useRouter();

const loading = ref(false);
const templates = ref<WorkflowTemplate[]>([]);
const total = ref(0);

const searchForm = ref({
  keyword: '',
  sortBy: 'time' as 'time' | 'usage'
});

const pagination = ref({
  page: 1,
  pageSize: 12
});

// 获取图片URL
const getImageUrl = (url: string) => {
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) {
    return `${window.location.origin}${url}`;
  }
  return `${window.location.origin}/uploads/${url}`;
};

// 格式化时间
const formatTime = (time: string) => {
  const date = new Date(time);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
};

// 搜索
const handleSearch = async () => {
  loading.value = true;
  try {
    const res = await getPublicTemplates({
      keyword: searchForm.value.keyword,
      sortBy: searchForm.value.sortBy,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize
    });
    const data = res.data as { list?: WorkflowTemplate[]; total?: number };
    templates.value = data?.list || [];
    total.value = data?.total || 0;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

// 重置搜索
const handleReset = () => {
  searchForm.value = {
    keyword: '',
    sortBy: 'time'
  };
  pagination.value.page = 1;
  handleSearch();
};

// 加载模板
const handleLoadTemplate = async (template: WorkflowTemplate) => {
  try {
    // 跳转到工作流编辑器并加载模板
    router.push({
      path: '/workflow',
      query: { templateId: template.id.toString() }
    });
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

onMounted(() => {
  handleSearch();
});
</script>

<style scoped>
.plaza-container {
  min-height: 100vh;
  width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f5f5;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.search-section {
  display: flex;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.workflow-masonry {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
  min-height: 0;
}

.workflow-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: all 0.3s;
}

.workflow-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.card-image {
  width: 100%;
  height: 0;
  padding-bottom: 75%; /* 4:3 比例，更合理的高度 */
  position: relative;
  overflow: hidden;
  background: #f0f0f0;
}

.cover-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}

.card-info {
  padding: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.card-stats {
  font-size: 12px;
  color: #909399;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.pagination {
  display: flex;
  justify-content: center;
  padding: 20px;
  background: white;
  border-radius: 8px;
  margin-top: auto;
  flex-shrink: 0;
}
</style>
