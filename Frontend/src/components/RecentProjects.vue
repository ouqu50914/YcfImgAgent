<template>
  <div class="recent-projects-container">
    <div class="section-header">
      <h3 class="section-title">最近项目</h3>
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
          <div class="project-time">{{ formatTime(project.updated_at || project.created_at) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Picture } from '@element-plus/icons-vue';
import { getTemplates, type WorkflowTemplate } from '@/api/workflow';

const router = useRouter();
const projects = ref<Array<{
  id?: number;
  name?: string;
  preview?: string;
  created_at?: string;
  updated_at?: string;
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
  if (project.id) {
    router.push(`/workflow?id=${project.id}`);
  }
};

const loadProjects = async () => {
  try {
    const res: any = await getTemplates();
    if (res.data && Array.isArray(res.data)) {
      projects.value = res.data.slice(0, 4).map((item: WorkflowTemplate) => {
        let preview: string | undefined = undefined;
        
        if (item.cover_image) {
          preview = item.cover_image;
        } else if (item.workflow_data && typeof item.workflow_data === 'object') {
          const nodes = item.workflow_data.nodes || [];
          const imageNode = nodes.find((node: any) => 
            node.type === 'image' && (node.data?.imageUrl || node.data?.image_url)
          );
          if (imageNode) {
            preview = imageNode.data?.imageUrl || imageNode.data?.image_url;
          }
        }
        
        return {
          id: item.id,
          name: item.name,
          preview,
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      });
    }
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

.projects-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
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
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
}

.project-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.15);
  transform: translateY(-4px);
}

.new-project-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
}
</style>
