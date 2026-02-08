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
        <h1 class="page-title">{{ isPublic ? '工作流广场' : '我的工作流' }}</h1>
      </div>
    </div>

    <!-- 搜索区域（公开时） / 说明（我的时） -->
    <div v-if="isPublic" class="search-section">
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
    <div v-else class="my-tip">管理你的工作流：未公开且未收藏的项目将在 14 天后自动删除，公开或收藏的项目永久保留。</div>

    <!-- 工作流列表（瀑布流布局） -->
    <div class="workflow-masonry" v-loading="loading">
      <!-- 公开：仅模板 -->
      <template v-if="isPublic">
        <div
          v-for="template in templates"
          :key="'t-' + template.id"
          class="workflow-card"
          @click="handleLoadTemplate(template)"
        >
          <div class="card-image" @click.stop="handleLoadTemplate(template)">
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
            <div class="card-actions card-actions-single">
              <el-button size="small" type="primary" @click.stop="handleLoadTemplate(template)">使用</el-button>
              <el-button size="small" @click.stop="handleFavorite(template)">收藏</el-button>
            </div>
          </div>
        </div>
      </template>
      <!-- 我的工作流：模板 + 自动保存历史 -->
      <template v-else>
        <div
          v-for="item in myItems"
          :key="item.source + '-' + item.data.id"
          class="workflow-card"
          @click="handleOpenItem(item)"
        >
          <div class="card-image" @click.stop="handleOpenItem(item)">
            <el-image
              v-if="getItemCover(item)"
              :src="getImageUrl(getItemCover(item)!)"
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
            <div class="card-title">{{ getItemName(item) }}</div>
            <div class="card-meta">
              <span class="time">{{ formatTime(getItemTime(item)) }}</span>
            </div>
            <div class="card-actions">
              <el-tooltip content="公开后永久保留，不会被自动删除">
                <el-switch :model-value="getItemPublic(item)" :active-value="1" :inactive-value="0" @update:model-value="(v: number) => handlePublicChange(item, v)" @click.stop />
              </el-tooltip>
              <span class="action-label">公开</span>
              <el-tooltip content="收藏后永久保留，不会被自动删除">
                <el-switch :model-value="getItemFavorite(item)" :active-value="1" :inactive-value="0" @update:model-value="(v: number) => handleFavoriteChange(item, v)" @click.stop />
              </el-tooltip>
              <span class="action-label">收藏</span>
              <el-button size="small" type="danger" @click.stop="handleDeleteItem(item)">删除</el-button>
              <el-button size="small" type="primary" @click.stop="handleOpenItem(item)">打开</el-button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && (isPublic ? templates.length === 0 : myItems.length === 0)" class="empty-state">
      <el-empty :description="isPublic ? '暂无公开工作流' : '暂无工作流，去首页创建吧'" />
    </div>

    <!-- 分页 -->
    <div class="pagination" v-if="isPublic && total > 0">
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
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Search } from '@element-plus/icons-vue';
import { getPublicTemplates, getTemplates, getTemplate, saveTemplate, updateTemplate, deleteTemplate, getHistoryList, updateHistory, deleteHistory, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';

const router = useRouter();
const route = useRoute();

const isPublic = computed(() => route.query.public === 'true');

const loading = ref(false);
const templates = ref<WorkflowTemplate[]>([]);
/** 我的工作流：合并后的列表（模板 + 自动保存历史），含 source 字段区分 */
const myItems = ref<Array<{ source: 'template'; data: WorkflowTemplate } | { source: 'history'; data: WorkflowHistory & { name?: string } }>>([]);
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

// 加载列表（公开 or 我的）
const loadList = async () => {
  loading.value = true;
  try {
    if (isPublic.value) {
      const res = await getPublicTemplates({
        keyword: searchForm.value.keyword,
        sortBy: searchForm.value.sortBy,
        page: pagination.value.page,
        pageSize: pagination.value.pageSize
      });
      const data = res.data as { list?: WorkflowTemplate[]; total?: number };
      templates.value = data?.list || [];
      total.value = data?.total || 0;
    } else {
      const [tplRes, histRes] = await Promise.all([
        getTemplates(),
        getHistoryList(100)
      ]);
      const tplArr = Array.isArray((tplRes as any)?.data) ? (tplRes as any).data : [];
      const histArr = Array.isArray((histRes as any)?.data) ? (histRes as any).data : [];
      const merged: typeof myItems.value = [];
      for (const t of tplArr as WorkflowTemplate[]) {
        merged.push({ source: 'template', data: t });
      }
      for (const h of histArr as WorkflowHistory[]) {
        merged.push({
          source: 'history',
          data: {
            ...h,
            name: h.snapshot_name || `自动保存 ${formatTime(h.created_at)}`
          }
        });
      }
      merged.sort((a, b) => {
        const ta = a.source === 'template' ? new Date(a.data.updated_at || a.data.created_at).getTime() : new Date(a.data.updated_at || a.data.created_at).getTime();
        const tb = b.source === 'template' ? new Date(b.data.updated_at || b.data.created_at).getTime() : new Date(b.data.updated_at || b.data.created_at).getTime();
        return tb - ta;
      });
      myItems.value = merged;
      total.value = merged.length;
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

type MyItem = typeof myItems.value[number];
const getItemCover = (item: MyItem) => item.data.cover_image;
const getItemName = (item: MyItem) => item.source === 'template' ? item.data.name : (item.data.name || item.data.snapshot_name || '自动保存');
const getItemTime = (item: MyItem) => item.source === 'template' ? (item.data.updated_at || item.data.created_at) : (item.data.updated_at || item.data.created_at);
const getItemPublic = (item: MyItem) => item.data.is_public ?? 0;
const getItemFavorite = (item: MyItem) => item.data.is_favorite ?? 0;

// 打开（模板用 id，历史用 historyId）
const handleOpenItem = (item: MyItem) => {
  if (item.source === 'template') {
    router.push({ path: '/workflow', query: { id: item.data.id.toString() } });
  } else {
    router.push({ path: '/workflow', query: { historyId: item.data.id.toString() } });
  }
};

const handlePublicChange = async (item: MyItem, v: number) => {
  if (item.source === 'template') {
    (item.data as WorkflowTemplate).is_public = v;
    await handleTogglePublic(item.data as WorkflowTemplate);
  } else {
    (item.data as WorkflowHistory).is_public = v;
    try {
      await updateHistory(item.data.id, { isPublic: v === 1 });
      ElMessage.success('已更新');
    } catch (e: any) {
      (item.data as WorkflowHistory).is_public = v === 1 ? 0 : 1;
      ElMessage.error(e.message || '操作失败');
    }
  }
};

const handleFavoriteChange = async (item: MyItem, v: number) => {
  if (item.source === 'template') {
    (item.data as WorkflowTemplate).is_favorite = v;
    await handleToggleFavorite(item.data as WorkflowTemplate);
  } else {
    (item.data as WorkflowHistory).is_favorite = v;
    try {
      await updateHistory(item.data.id, { isFavorite: v === 1 });
      ElMessage.success('已更新');
    } catch (e: any) {
      (item.data as WorkflowHistory).is_favorite = v === 1 ? 0 : 1;
      ElMessage.error(e.message || '操作失败');
    }
  }
};

const handleDeleteItem = async (item: MyItem) => {
  try {
    await ElMessageBox.confirm('删除后关联的上传图片也会删除，确定删除？', '确认删除', { type: 'warning' });
    if (item.source === 'template') {
      await deleteTemplate(item.data.id);
    } else {
      await deleteHistory(item.data.id);
    }
    ElMessage.success('已删除');
    loadList();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败');
  }
};

const handleSearch = () => loadList();

// 重置搜索
const handleReset = () => {
  searchForm.value = {
    keyword: '',
    sortBy: 'time'
  };
  pagination.value.page = 1;
  handleSearch();
};

// 打开工作流
const handleLoadTemplate = (template: WorkflowTemplate) => {
  router.push({ path: '/workflow', query: { id: template.id.toString() } });
};

const makePublicChange = (t: WorkflowTemplate) => (v: number) => {
  t.is_public = v;
  handleTogglePublic(t);
};

const makeFavoriteChange = (t: WorkflowTemplate) => (v: number) => {
  t.is_favorite = v;
  handleToggleFavorite(t);
};

// 我的工作流：切换公开
const handleTogglePublic = async (template: WorkflowTemplate) => {
  try {
    await updateTemplate(template.id, { isPublic: template.is_public === 1 });
    ElMessage.success('已更新');
  } catch (e: any) {
    template.is_public = template.is_public === 1 ? 0 : 1;
    ElMessage.error(e.message || '操作失败');
  }
};

// 我的工作流：切换收藏
const handleToggleFavorite = async (template: WorkflowTemplate) => {
  try {
    await updateTemplate(template.id, { isFavorite: template.is_favorite === 1 });
    ElMessage.success('已更新');
  } catch (e: any) {
    template.is_favorite = template.is_favorite === 1 ? 0 : 1;
    ElMessage.error(e.message || '操作失败');
  }
};

// 我的工作流：删除
const handleDelete = async (template: WorkflowTemplate) => {
  try {
    await ElMessageBox.confirm('删除后关联的上传图片也会删除，确定删除？', '确认删除', { type: 'warning' });
    await deleteTemplate(template.id);
    ElMessage.success('已删除');
    loadList();
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败');
  }
};

// 公开列表：收藏（另存为我的并设为收藏）
const handleFavorite = async (template: WorkflowTemplate) => {
  try {
    const res: any = await getTemplate(template.id);
    const data = res?.data;
    if (!data || !data.workflow_data) {
      ElMessage.error('无法获取工作流数据');
      return;
    }
    await saveTemplate({
      name: (data.name || '未命名') + ' (副本)',
      workflowData: data.workflow_data,
      description: data.description,
      isPublic: false,
      isFavorite: true,
      coverImage: data.cover_image,
      category: data.category || 'other'
    });
    ElMessage.success('已收藏到我的工作流');
  } catch (e: any) {
    ElMessage.error(e.message || '收藏失败');
  }
};

watch(() => route.query.public, () => loadList(), { immediate: false });

onMounted(() => {
  loadList();
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

.my-tip {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #fff7e6;
  border-radius: 8px;
  color: #ad6800;
  font-size: 14px;
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

.card-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
}

.card-actions .action-label {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  flex-shrink: 0;
}

.card-actions .el-switch {
  flex-shrink: 0;
}

.card-actions .el-button {
  flex-shrink: 0;
  white-space: nowrap;
}

.card-actions-single {
  margin-top: 8px;
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
