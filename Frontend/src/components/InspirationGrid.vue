<template>
  <div class="inspiration-grid-container">
    <div class="section-header">
      <h3 class="section-title">灵感发现</h3>
    </div>
    
    <div class="category-tags">
      <el-tag
        :type="selectedCategory === 'all' ? 'primary' : 'info'"
        class="category-tag"
        @click="handleCategoryClick('all')"
      >
        全部
      </el-tag>
      <el-tag
        v-for="category in categories"
        :key="category.code"
        :type="selectedCategory === category.code ? 'primary' : 'info'"
        class="category-tag"
        @click="handleCategoryClick(category.code)"
      >
        {{ category.name }}
      </el-tag>
    </div>
    
    <div v-loading="loading" class="masonry-grid">
      <div
        v-for="template in templates"
        :key="template.id"
        class="template-card"
        @click="handleTemplateClick(template)"
      >
        <div class="template-preview">
          <img
            v-if="template.cover_image"
            :src="getImageUrl(template.cover_image)"
            alt="模板预览"
            @error="handleImageError"
          />
          <div v-else class="template-placeholder">
            <el-icon :size="48"><Picture /></el-icon>
          </div>
          <div class="template-overlay">
            <div class="template-stats">
              <span><el-icon><View /></el-icon> {{ template.usage_count || 0 }}</span>
            </div>
          </div>
        </div>
        <div class="template-info">
          <div class="template-name">{{ template.name || '未命名模板' }}</div>
          <div class="template-author" v-if="template.author_name">
            <el-icon><User /></el-icon>
            {{ template.author_name }}
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="templates.length === 0 && !loading" class="empty-state">
      <el-icon :size="64" class="empty-icon"><Document /></el-icon>
      <p>暂无公开模板</p>
    </div>
    
    <div v-if="hasMore" class="load-more">
      <el-button @click="loadMore" :loading="loading">加载更多</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Picture, View, User, Document } from '@element-plus/icons-vue';
import { getPublicTemplates, type WorkflowTemplate } from '@/api/workflow';
import { getActiveCategories, type WorkflowCategory } from '@/api/category';

const router = useRouter();
const loading = ref(false);
const templates = ref<WorkflowTemplate[]>([]);
const total = ref(0);
const selectedCategory = ref('all');
const currentPage = ref(1);
const pageSize = ref(12);
const categories = ref<WorkflowCategory[]>([]);

const getImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) {
    return `${window.location.origin}${url}`;
  }
  return `${window.location.origin}/uploads/${url}`;
};

const handleImageError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) {
    target.style.display = 'none';
  }
};

const handleCategoryClick = (value: string) => {
  selectedCategory.value = value;
  currentPage.value = 1;
  templates.value = [];
  loadTemplates();
};

const loadCategories = async () => {
  try {
    const res: any = await getActiveCategories();
    categories.value = res.data || [];
  } catch (error) {
    console.error('加载分类失败:', error);
  }
};

const handleTemplateClick = (template: WorkflowTemplate) => {
  router.push(`/workflow?id=${template.id}`);
};

const hasMore = computed(() => {
  return templates.value.length < total.value;
});

const loadTemplates = async (append = false) => {
  if (loading.value) return;
  
  loading.value = true;
  try {
    const params: any = {
      page: currentPage.value,
      pageSize: pageSize.value,
      sortBy: 'time',
    };
    
    // 如果选择了分类（不是"全部"），添加分类筛选
    if (selectedCategory.value !== 'all') {
      params.category = selectedCategory.value;
    }
    
    const res: any = await getPublicTemplates(params);
    
    if (res.data) {
      if (append) {
        templates.value.push(...res.data.list);
      } else {
        templates.value = res.data.list;
      }
      total.value = res.data.total;
    }
  } catch (error) {
    console.error('加载模板失败:', error);
  } finally {
    loading.value = false;
  }
};

const loadMore = () => {
  currentPage.value++;
  loadTemplates(true);
};

onMounted(() => {
  loadCategories();
  loadTemplates();
});
</script>

<style scoped>
.inspiration-grid-container {
  width: 100%;
}

.section-header {
  margin-bottom: 16px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.category-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: thin;
}

.category-tags::-webkit-scrollbar {
  height: 4px;
}

.category-tag {
  cursor: pointer;
  transition: all 0.3s;
  padding: 8px 16px;
  font-size: 14px;
  white-space: nowrap;
}

.category-tag:hover {
  transform: translateY(-2px);
}

.masonry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.template-card {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
}

.template-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.15);
  transform: translateY(-4px);
}

.template-preview {
  width: 100%;
  height: 0;
  padding-bottom: 100%;
  position: relative;
  background: #f5f5f5;
  overflow: hidden;
}

.template-preview img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.template-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
}

.template-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
  padding: 12px;
  opacity: 0;
  transition: opacity 0.3s;
}

.template-card:hover .template-overlay {
  opacity: 1;
}

.template-stats {
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.template-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.template-author {
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 4px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #909399;
}

.empty-icon {
  margin-bottom: 16px;
  color: #c0c4cc;
}

.load-more {
  text-align: center;
  margin-top: 24px;
}

@media (max-width: 1024px) {
  .masonry-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }
}

@media (max-width: 768px) {
  .masonry-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .masonry-grid {
    grid-template-columns: 1fr;
  }
}
</style>
