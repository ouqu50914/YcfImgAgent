<template>
  <div class="quick-start-container">
    <!-- 中央输入框卡片 -->
    <div class="input-card">
      <div class="input-wrapper">
        <div class="input-left">
          <!-- 上传文件图标 -->
          <el-icon class="attach-icon" @click="handleFileUpload" title="上传文件">
            <Paperclip />
          </el-icon>
          
          <!-- 输入框区域 -->
          <div class="input-content">
            <!-- 上传文件后显示文件预览 -->
            <div v-if="uploadedFile" class="uploaded-file-preview">
              <el-image
                v-if="filePreviewUrl"
                :src="filePreviewUrl"
                fit="cover"
                class="preview-image"
                :preview-src-list="[filePreviewUrl]"
              />
              <div class="file-info">
                <span class="file-name">{{ uploadedFile.name }}</span>
                <el-icon class="remove-file-icon" @click="removeFile">
                  <Close />
                </el-icon>
              </div>
            </div>
            
            <!-- 提示词输入框 -->
            <input
              v-model="inputValue"
              type="text"
              class="quick-input"
              :placeholder="uploadedFile ? '这里是设计提示词' : '输入提示词，让AI帮你生成图片...'"
              @keyup.enter="handleSubmit"
            />
          </div>
        </div>
        
        <!-- 右侧操作图标 -->
        <div class="input-right">
          <el-icon class="action-icon" @click="handleInspiration" title="灵感">
            <Search />
          </el-icon>
          <el-icon class="action-icon" @click="handleQuickAction" title="快速操作">
            <Clock />
          </el-icon>
          <el-icon class="action-icon" @click="handleLanguage" title="语言设置">
            <Connection />
          </el-icon>
          
          <!-- 模型选择下拉菜单 -->
          <div class="model-selector-wrapper">
            <el-icon 
              class="action-icon model-icon" 
              :class="{ active: showModelDropdown }"
              @click="showModelDropdown = !showModelDropdown"
              title="模型选择"
            >
              <Grid />
            </el-icon>
            
            <!-- 模型下拉菜单 -->
            <div v-if="showModelDropdown" class="model-dropdown" @click.stop>
              <div class="dropdown-header">Image</div>
              <div 
                v-for="model in models" 
                :key="model.value"
                class="dropdown-item"
                :class="{ selected: selectedModel === model.value }"
                @click="handleModelSelect(model.value)"
              >
                <span v-if="selectedModel === model.value" class="selected-dot">•</span>
                {{ model.label }}
              </div>
            </div>
          </div>
          
          <el-icon class="action-icon submit-icon" @click="handleSubmit" title="提交">
            <Top />
          </el-icon>
        </div>
      </div>
    </div>
    
    <!-- 分类标签区域 -->
    <div class="category-tags">
      <div
        v-for="tag in categoryTags"
        :key="tag.value"
        class="category-tag"
        :class="{ 
          active: selectedCategory === tag.value,
          'model-tag': tag.isModel,
          [tag.color]: tag.color
        }"
        @click="handleCategoryClick(tag.value)"
      >
        <el-icon v-if="tag.icon" class="tag-icon">
          <component :is="tag.icon" />
        </el-icon>
        {{ tag.label }}
      </div>
    </div>
    
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleFileChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  Paperclip, 
  Search, 
  Clock, 
  Connection, 
  Grid, 
  Top, 
  Close,
  Picture,
  Star,
  EditPen,
  Monitor,
  VideoPlay
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { uploadImage } from '@/api/upload';

const router = useRouter();
const inputValue = ref('');
const selectedModel = ref('nano');
const selectedCategory = ref('nano');
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadedFile = ref<File | null>(null);
const filePreviewUrl = ref<string>('');
const showModelDropdown = ref(false);

const models = [
  { label: 'Nano Banana Pro', value: 'nano' },
  { label: 'Dream AI', value: 'dream' },
];

const categoryTags = [
  { 
    label: 'Nano Banana Pro', 
    value: 'nano', 
    isModel: true, 
    color: 'orange',
    icon: 'Picture'
  },
  { 
    label: 'Design', 
    value: 'design', 
    isModel: false,
    icon: 'Picture'
  },
  { 
    label: 'Branding', 
    value: 'branding', 
    isModel: false,
    icon: 'Star'
  },
  { 
    label: 'Illustration', 
    value: 'illustration', 
    isModel: false,
    icon: 'EditPen'
  },
  { 
    label: 'E-Commerce', 
    value: 'ecommerce', 
    isModel: false,
    icon: 'Monitor'
  },
  { 
    label: 'Video', 
    value: 'video', 
    isModel: false,
    icon: 'VideoPlay'
  },
];

const handleCategoryClick = (value: string) => {
  selectedCategory.value = value;
  // 如果是模型标签，同时更新模型选择
  const modelTag = categoryTags.find(tag => tag.value === value && tag.isModel);
  if (modelTag) {
    selectedModel.value = value;
  }
};

const handleModelSelect = (value: string) => {
  selectedModel.value = value;
  showModelDropdown.value = false;
  // 同步更新分类标签
  selectedCategory.value = value;
};

const handleFileUpload = () => {
  fileInputRef.value?.click();
};

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    uploadedFile.value = file;
    // 创建预览URL
    filePreviewUrl.value = URL.createObjectURL(file);
    ElMessage.success('文件已选择');
  }
};

const removeFile = () => {
  if (filePreviewUrl.value) {
    URL.revokeObjectURL(filePreviewUrl.value);
  }
  uploadedFile.value = null;
  filePreviewUrl.value = '';
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
};

const handleInspiration = () => {
  router.push({ path: '/workflow-plaza', query: { public: 'true' } });
};

const handleQuickAction = () => {
  // 快速操作：可以添加常用操作
  ElMessage.info('快速操作功能');
};

const handleLanguage = () => {
  // 语言设置
  ElMessage.info('语言设置功能');
};

const handleSubmit = async () => {
  if (!inputValue.value.trim() && !uploadedFile.value) {
    ElMessage.warning('请输入提示词或上传图片');
    return;
  }
  
  // 如果有上传的图片，先上传获取URL
  let imageUrl = '';
  if (uploadedFile.value) {
    try {
      ElMessage.info('正在上传图片...');
      const res: any = await uploadImage(uploadedFile.value);
      if (res.data && res.data.url) {
        imageUrl = res.data.url;
        ElMessage.success('图片上传成功');
      } else {
        ElMessage.error('图片上传失败');
        return;
      }
    } catch (error: any) {
      ElMessage.error(error.message || '图片上传失败');
      return;
    }
  }
  
  // 跳转到工作流编辑页面，传递参数
  const query: any = {};
  if (inputValue.value.trim()) {
    query.prompt = inputValue.value.trim();
  }
  if (selectedModel.value) {
    query.model = selectedModel.value;
  }
  if (imageUrl) {
    query.imageUrl = imageUrl;
  }
  
  router.push({
    path: '/workflow',
    query
  });
};

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.model-selector-wrapper')) {
    showModelDropdown.value = false;
  }
};

// 监听点击事件
if (typeof window !== 'undefined') {
  document.addEventListener('click', handleClickOutside);
}

// 组件卸载时移除事件监听器
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    document.removeEventListener('click', handleClickOutside);
  }
  // 清理文件预览URL
  if (filePreviewUrl.value) {
    URL.revokeObjectURL(filePreviewUrl.value);
  }
});
</script>

<style scoped>
.quick-start-container {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

/* 中央输入框卡片 */
.input-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  margin-bottom: 20px;
}

.input-wrapper {
  display: flex;
  align-items: center;
  gap: 16px;
}

.input-left {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 12px;
}

.attach-icon {
  color: #606266;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 20px;
  flex-shrink: 0;
}

.attach-icon:hover {
  color: #409eff;
  transform: scale(1.1);
}

.input-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.uploaded-file-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 8px;
}

.preview-image {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}

.file-info {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.file-name {
  font-size: 14px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.remove-file-icon {
  color: #909399;
  cursor: pointer;
  transition: color 0.3s;
  font-size: 16px;
}

.remove-file-icon:hover {
  color: #f56c6c;
}

.quick-input {
  border: none;
  outline: none;
  font-size: 16px;
  color: #303133;
  background: transparent;
  width: 100%;
}

.quick-input::placeholder {
  color: #c0c4cc;
}

.input-right {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.action-icon {
  color: #606266;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 20px;
  padding: 8px;
  border-radius: 8px;
}

.action-icon:hover {
  color: #409eff;
  background: #ecf5ff;
}

.model-icon.active {
  color: #409eff;
  background: #ecf5ff;
}

.submit-icon {
  color: #409eff;
}

.submit-icon:hover {
  background: #ecf5ff;
  transform: scale(1.1);
}

/* 模型选择下拉菜单 */
.model-selector-wrapper {
  position: relative;
}

.model-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #e0e0e0;
  background: #f5f7fa;
}

.dropdown-item {
  padding: 12px 16px;
  font-size: 14px;
  color: #606266;
  cursor: pointer;
  transition: background 0.3s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropdown-item:hover {
  background: #f5f7fa;
}

.dropdown-item.selected {
  color: #409eff;
  background: #ecf5ff;
}

.selected-dot {
  font-size: 20px;
  line-height: 1;
}

/* 分类标签区域 */
.category-tags {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.category-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #e0e0e0;
}

.category-tag:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.category-tag.active {
  background: #ecf5ff;
  color: #409eff;
  border-color: #409eff;
}

.category-tag.model-tag.orange {
  background: #fff7e6;
  color: #fa8c16;
  border-color: #ffd591;
}

.category-tag.model-tag.orange.active {
  background: #fff1d9;
  border-color: #fa8c16;
}

.tag-icon {
  font-size: 16px;
}

@media (max-width: 768px) {
  .input-card {
    padding: 16px;
  }
  
  .input-wrapper {
    flex-direction: column;
    align-items: stretch;
  }
  
  .input-right {
    justify-content: space-between;
    width: 100%;
  }
  
  .category-tags {
    justify-content: flex-start;
  }
}
</style>
