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
        :key="`${project.source}-${project.id}`"
        class="project-card"
        @click="handleProjectClick(project)"
      >
        <div class="project-preview">
          <img
            v-if="project.preview"
            :src="getImageUrl(project.preview)"
            alt="项目预览"
            loading="lazy"
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
            <div class="project-actions">
              <el-button
                type="primary"
                link
                size="small"
                @click.stop="handleRename(project)"
              >
                重命名
              </el-button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Picture } from '@element-plus/icons-vue';
import {
  getRecentProjects,
  deleteTemplate,
  deleteHistory,
  updateTemplate,
  updateHistory,
  type RecentProjectItem,
} from '@/api/workflow';
import { notifyWorkflowListChanged } from '@/utils/workflow-list-events';
import { getUploadUrl } from '@/utils/image-loader';

const router = useRouter();
const projects = ref<RecentProjectItem[]>([]);

const getImageUrl = (url: string) => getUploadUrl(url);

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
  router.push('/workflow?new=1');
};

const handleProjectClick = (project: RecentProjectItem) => {
  if (project.source === 'history') {
    router.push(`/workflow?historyId=${project.id}`);
  } else {
    router.push(`/workflow?id=${project.id}`);
  }
};

const handleDelete = async (project: RecentProjectItem) => {
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
    notifyWorkflowListChanged();
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('[RecentProjects] 删除失败', e);
      if (!(e as any)?.response) {
        ElMessage.error('删除失败，请稍后重试');
      }
    }
  }
};

const handleRename = async (project: RecentProjectItem) => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的名称', '重命名', {
      inputValue: project.name || '',
      inputPlaceholder: '请输入名称',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (val: string) => {
        if (!val || !val.trim()) return '名称不能为空';
        if (val.trim().length > 50) return '名称长度不能超过 50 个字符';
        return true;
      },
    });
    const newName = (value as string).trim();
    if (!newName) return;
    if (project.source === 'history') {
      await updateHistory(project.id, { snapshot_name: newName });
    } else {
      await updateTemplate(project.id, { name: newName });
    }
    ElMessage.success('重命名成功');
    loadProjects();
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('[RecentProjects] 重命名失败', e);
      if (!(e as any)?.response) {
        ElMessage.error('重命名失败，请稍后重试');
      }
    }
  }
};

const loadProjects = async () => {
  try {
    const res: any = await getRecentProjects(5);
    projects.value = res.data || [];
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-main);
  margin: 0;
}

.more-link {
  font-size: 14px;
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.more-link:hover {
  text-decoration: underline;
}

.projects-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 12px 0 8px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--text-subtle) var(--app-bg-sub);
}

.projects-scroll::-webkit-scrollbar {
  height: 6px;
}

.projects-scroll::-webkit-scrollbar-track {
  background: var(--app-bg-sub);
  border-radius: 3px;
}

.projects-scroll::-webkit-scrollbar-thumb {
  background: var(--text-subtle);
  border-radius: 3px;
}

.projects-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

.project-card {
  flex-shrink: 0;
  width: 200px;
  background: var(--app-surface);
  border: 1px solid var(--app-border-color);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
}

.project-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  transform: translateY(-4px);
}

.new-project-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  background: var(--app-bg-sub);
  border-style: dashed;
}

.plus-icon {
  color: var(--color-primary);
  margin-bottom: 8px;
}

.new-project-text {
  font-size: 14px;
  color: var(--text-muted);
}

.project-preview {
  width: 100%;
  height: 0;
  padding-bottom: 75%;
  position: relative;
  background: var(--app-bg-sub);
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
  color: var(--text-subtle);
}

.project-info {
  padding: 12px;
}

.project-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.project-time {
  font-size: 12px;
  color: var(--text-muted);
}

.project-actions {
  display: flex;
  gap: 4px;
}
</style>
