<template>
  <div class="recent-projects-container">
    <div class="section-header">
      <h3 class="section-title">最近项目</h3>
      <router-link to="/workflow-plaza" class="more-link">MORE</router-link>
    </div>
    <div class="projects-scroll">
      <div 
        class="project-card new-project-card"
        @click="handleNewProject"
      >
        <el-icon :size="48" class="plus-icon"><Plus /></el-icon>
        <div class="new-project-text">新建项目</div>
      </div>
      <div
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        @click="handleProjectClick(project)"
      >
        <div class="project-preview">
          <img
            v-if="project.preview"
            :src="getImageUrl(project.preview)"
            alt="项目预览"
            @error="handleImageError"
          />
          <div v-else class="project-placeholder">
            <el-icon :size="32"><Picture /></el-icon>
          </div>
        </div>
        <div class="project-info">
          <div class="project-name">{{ project.name || '未命名工作流' }}</div>
          <div class="project-meta">
            <span class="project-time">{{ formatTime((project.updated_at || project.created_at) || '') }}</span>
            <el-button
              type="danger"
              link
              size="small"
              @click.stop="handleDelete(project)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Picture } from '@element-plus/icons-vue';
import { getTemplates, getHistoryList, deleteTemplate, deleteHistory, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';

const router = useRouter();
const projects = ref<Array<{
  id?: number;
  name?: string;
  preview?: string;
  created_at?: string;
  updated_at?: string;
  source?: 'template' | 'history';
}>>([]);

const getImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) {
    return `${window.location.origin}${url}`;
  }
  return `${window.location.origin}/uploads/${url}`;
};

const formatTime = (time: string) => {
  if (!time) return '';
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

const handleImageError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) {
    target.style.display = 'none';
  }
};

const handleNewProject = () => {
  router.push('/workflow');
};

const handleProjectClick = (project: any) => {
  if (project.id == null) return;
  if (project.source === 'history') {
    router.push(`/workflow?historyId=${project.id}`);
  } else {
    router.push(`/workflow?id=${project.id}`);
  }
};

const handleDelete = async (project: any) => {
  if (project.id == null) return;
  try {
    await ElMessageBox.confirm('删除后关联的上传图片也会删除，确定删除？', '确认删除', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    });
    if (project.source === 'history') {
      await deleteHistory(project.id);
    } else {
      await deleteTemplate(project.id);
    }
    ElMessage.success('已删除');
    loadProjects();
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '删除失败');
    }
  }
};

function getPreviewFromWorkflowData(workflowData: any): string | undefined {
  if (!workflowData || typeof workflowData !== 'object') return undefined;
  // 优先使用自动保存时生成的编辑器截图封面
  if (workflowData.cover_image) return workflowData.cover_image;
  const nodes = workflowData.nodes || [];
  const imageNode = nodes.find((node: any) =>
    node.type === 'image' && (node.data?.imageUrl || node.data?.image_url)
  );
  return imageNode ? (imageNode.data?.imageUrl || imageNode.data?.image_url) : undefined;
}

const loadProjects = async () => {
  try {
    const [templatesRes, historyRes] = await Promise.all([
      getTemplates(),
      getHistoryList(5),
    ]);
    const list: Array<{
      id: number;
      name: string;
      preview?: string;
      created_at?: string;
      updated_at?: string;
      source: 'template' | 'history';
      _sortTime: number;
    }> = [];
    if (templatesRes.data && Array.isArray(templatesRes.data)) {
      for (const item of templatesRes.data as WorkflowTemplate[]) {
        let preview: string | undefined;
        if (item.cover_image) preview = item.cover_image;
        else preview = getPreviewFromWorkflowData(item.workflow_data);
        const t = new Date(item.updated_at || item.created_at || 0).getTime();
        list.push({
          id: item.id,
          name: item.name || '未命名工作流',
          preview,
          created_at: item.created_at,
          updated_at: item.updated_at,
          source: 'template',
          _sortTime: t,
        });
      }
    }
    if (historyRes.data && Array.isArray(historyRes.data)) {
      for (const item of historyRes.data as WorkflowHistory[]) {
        const t = new Date(item.created_at || 0).getTime();
        // 列表接口已返回 cover_image；若无则尝试从 workflow_data 解析（可能为字符串）
        const preview = item.cover_image ?? (typeof item.workflow_data === 'object' ? getPreviewFromWorkflowData(item.workflow_data) : undefined);
        list.push({
          id: item.id,
          name: item.snapshot_name || `自动保存 ${formatTime(item.created_at)}`,
          preview,
          created_at: item.created_at,
          updated_at: item.created_at,
          source: 'history',
          _sortTime: t,
        });
      }
    }
    list.sort((a, b) => b._sortTime - a._sortTime);
    projects.value = list.slice(0, 5).map(({ _sortTime, ...rest }) => rest);
  } catch (error) {
    console.error('加载最近项目失败:', error);
  }
};

onMounted(() => {
  loadProjects();
});

defineExpose({
  loadProjects
});
</script>

<style scoped>
.recent-projects-container {
  width: 100%;
  margin-bottom: 40px;
  overflow: visible;
}

.section-header {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.more-link {
  font-size: 14px;
  color: #409eff;
  text-decoration: none;
}

.more-link:hover {
  text-decoration: underline;
}

/* 上内边距留出空间，避免卡片 hover 上浮时被裁切 */
.projects-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 12px 0 8px 0;
  scrollbar-width: thin;
  scrollbar-color: #c0c4cc #f5f5f5;
}

.projects-scroll::-webkit-scrollbar {
  height: 6px;
}

.projects-scroll::-webkit-scrollbar-track {
  background: #f5f5f5;
  border-radius: 3px;
}

.projects-scroll::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.projects-scroll::-webkit-scrollbar-thumb:hover {
  background: #909399;
}

.project-card {
  flex-shrink: 0;
  width: 200px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 0;
}

.project-card:hover {
  border-color: #409eff;
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.2);
  transform: translateY(-6px);
  z-index: 1;
}

.new-project-card {
  background: #c0c4cc;
  border: none;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}

.new-project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
}

.plus-icon {
  margin-bottom: 12px;
}

.new-project-text {
  font-size: 16px;
  font-weight: 500;
}

.project-preview {
  width: 100%;
  height: 0;
  padding-bottom: 75%;
  position: relative;
  background: #f5f5f5;
  overflow: hidden;
}

.project-preview img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-placeholder {
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

.project-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.project-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-time {
  font-size: 12px;
  color: #909399;
  flex: 1;
  min-width: 0;
}
</style>
