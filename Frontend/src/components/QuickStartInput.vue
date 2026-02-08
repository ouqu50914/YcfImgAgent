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
            <!-- 上传文件后显示文件预览（最多4个） -->
            <div v-if="uploadedFiles.length > 0" class="uploaded-files-preview">
              <div
                v-for="(file, index) in uploadedFiles"
                :key="index"
                class="file-preview-item"
              >
                <el-image
                  :src="filePreviewUrls[index]"
                  fit="cover"
                  class="preview-image-small"
                  :preview-src-list="filePreviewUrls"
                  :initial-index="index"
                />
                <span class="file-name-small">{{ file.name }}</span>
                <el-icon class="remove-file-icon-small" @click="removeFile(index)">
                  <Close />
                </el-icon>
              </div>
            </div>
            
            <!-- 提示词输入框 -->
            <input
              v-model="inputValue"
              type="text"
              class="quick-input"
              :placeholder="uploadedFiles.length > 0 ? '这里是设计提示词' : '输入提示词，让AI帮你生成图片...'"
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
  Close
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { uploadImage } from '@/api/upload';

const router = useRouter();
const inputValue = ref('');
const selectedModel = ref('nano');
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadedFiles = ref<File[]>([]);
const filePreviewUrls = ref<string[]>([]);
const showModelDropdown = ref(false);

const models = [
  { label: 'Nano Banana Pro', value: 'nano' },
  { label: 'Dream AI', value: 'dream' },
];

const handleModelSelect = (value: string) => {
  selectedModel.value = value;
  showModelDropdown.value = false;
};

const handleFileUpload = () => {
  fileInputRef.value?.click();
};

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const isSupportedImageFile = (file: File) => file.type && SUPPORTED_IMAGE_TYPES.includes(file.type);

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    if (!isSupportedImageFile(file)) {
      ElMessage.warning('不支持的图片格式，请上传 JPG、PNG、GIF、WebP 等图片');
      if (fileInputRef.value) fileInputRef.value.value = '';
      return;
    }
    // 检查是否已达到最大数量
    if (uploadedFiles.value.length >= 4) {
      ElMessage.warning('最多只能上传4个文件');
      if (fileInputRef.value) {
        fileInputRef.value.value = '';
      }
      return;
    }
    
    // 添加到文件数组
    uploadedFiles.value.push(file);
    // 创建预览URL
    filePreviewUrls.value.push(URL.createObjectURL(file));
    ElMessage.success('文件已选择');
    
    // 清空input以便可以再次选择
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  }
};

const removeFile = (index: number) => {
  // 清理预览URL
  if (filePreviewUrls.value[index]) {
    URL.revokeObjectURL(filePreviewUrls.value[index]);
  }
  // 从数组中移除
  uploadedFiles.value.splice(index, 1);
  filePreviewUrls.value.splice(index, 1);
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
  if (!inputValue.value.trim() && uploadedFiles.value.length === 0) {
    ElMessage.warning('请输入提示词或上传图片');
    return;
  }
  
  // 如果有上传的图片，先上传获取URL
  const imageUrls: string[] = [];
  if (uploadedFiles.value.length > 0) {
    try {
      for (let i = 0; i < uploadedFiles.value.length; i++) {
        const file = uploadedFiles.value[i] as File;
        if (!file || typeof file !== 'object' || !('name' in file)) {
          ElMessage.error(`第 ${i + 1} 个文件不是有效的图片文件`);
          return;
        }
        if (!isSupportedImageFile(file)) {
          ElMessage.warning(`第 ${i + 1} 个文件格式不支持，请上传 JPG、PNG、GIF、WebP 等图片`);
          return;
        }
      }
      ElMessage.info(`正在上传 ${uploadedFiles.value.length} 个图片...`);
      for (let i = 0; i < uploadedFiles.value.length; i++) {
        const file = uploadedFiles.value[i];
        if (file && typeof file === 'object' && 'name' in file && 'size' in file) {
          const res: any = await uploadImage(file as File);
          if (res.data && res.data.url) {
            imageUrls.push(res.data.url);
          } else {
            ElMessage.error(`第 ${i + 1} 个图片上传失败`);
            return;
          }
        } else {
          ElMessage.error(`第 ${i + 1} 个文件不是有效的图片文件`);
          return;
        }
      }
      ElMessage.success('所有图片上传成功');
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
  if (imageUrls.length > 0) {
    // 传递多个图片URL，使用逗号分隔
    query.imageUrls = imageUrls.join(',');
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
  // 清理所有文件预览URL
  filePreviewUrls.value.forEach(url => {
    URL.revokeObjectURL(url);
  });
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

.uploaded-files-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px;
  background: #f5f7fa;
  border-radius: 8px;
}

.file-preview-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.preview-image-small {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.file-name-small {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.remove-file-icon-small {
  color: #909399;
  cursor: pointer;
  transition: color 0.3s;
  font-size: 14px;
  flex-shrink: 0;
}

.remove-file-icon-small:hover {
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
  
  .file-name-small {
    max-width: 80px;
  }
}
</style>
