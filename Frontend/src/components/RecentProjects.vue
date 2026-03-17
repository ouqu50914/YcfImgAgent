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
import { getTemplates, getHistoryList, deleteTemplate, deleteHistory, updateTemplate, updateHistory, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';
import { getUploadUrl } from '@/utils/image-loader';

const router = useRouter();
const projects = ref<Array<{
  id?: number;
  name?: string;
  preview?: string;
  created_at?: string;
  updated_at?: string;
  source?: 'template' | 'history';
}>>([]);

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
  // 显式标记为“新建项目”，编辑页不再自动恢复上一次自动保存
  router.push('/workflow?new=1');
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
      console.error('[RecentProjects] 删除失败', e);
      // 统一错误提示交给全局拦截器
      if (!(e as any)?.response) {
        ElMessage.error('删除失败，请稍后重试');
      }
    }
  }
};

const handleRename = async (project: any) => {
  if (project.id == null) return;
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
      // 首页最近项目：工作流历史多取一些，前端按项目去重后再截取
      getHistoryList(20),
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
      // 将同一个项目的多条自动保存历史合并为一条（取最新的那条）
      // 这里用 cover_image 作为项目分组 key；若无封面则退回到 history id
      const grouped: Record<string, WorkflowHistory> = {};
      for (const item of historyRes.data as WorkflowHistory[]) {
        // 已经绑定到具体项目的历史记录，不再单独作为“最近项目”卡片展示
        if ((item as any).template_id != null) continue;
        const key = item.cover_image || `history_${item.id}`;
        const existing = grouped[key];
        if (!existing) {
          grouped[key] = item;
          continue;
        }
        const existingTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
        const currentTime = new Date(item.updated_at || item.created_at || 0).getTime();
        if (currentTime > existingTime) {
          grouped[key] = item;
        }
      }

      const mergedHistories = Object.values(grouped);
      for (const item of mergedHistories) {
        const t = new Date(item.updated_at || item.created_at || 0).getTime();
        // 列表接口已返回 cover_image；若无则尝试从 workflow_data 解析（可能为字符串）
        const preview = item.cover_image ?? (typeof item.workflow_data === 'object' ? getPreviewFromWorkflowData(item.workflow_data) : undefined);
        list.push({
          id: item.id,
          name: item.snapshot_name || '自动保存工作流',
          preview,
          created_at: item.created_at,
          updated_at: item.updated_at,
          source: 'history',
          _sortTime: t,
        });
      }
    }
    list.sort((a, b) => b._sortTime - a._sortTime);
    // 首页最多展示 5 条最近项目（模板 + 历史）
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
  color: var(--text-main);
  margin: 0;
}

.more-link {
  font-size: 14px;
  color: var(--color-primary);
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
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 0;
}

.project-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.25);
  transform: translateY(-6px);
  z-index: 1;
}

.new-project-card {
  background: var(--color-primary);
  border: none;
  color: var(--text-strong);
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
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-time {
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
}
</style>
