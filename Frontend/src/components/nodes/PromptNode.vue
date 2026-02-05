<template>
    <div class="prompt-node">
      <div class="node-header">
        <el-icon><EditPen /></el-icon>
        <span>提示词输入</span>
      </div>
      
      <div class="node-content">
            <div class="prompt-content nodrag">
        <el-input
                    ref="promptInputRef"
          v-model="text"
          type="textarea"
                    :autosize="{ minRows: 6, maxRows: 12 }"
                    placeholder="输入提示词，输入 / 可选择已保存提示词"
                    class="prompt-input"
                    maxlength="2000"
                    @input="handlePromptInput"
                    @keydown="handlePromptKeydown"
                />
                
                <!-- 提示词列表下拉框 -->
                <div
                    v-if="showPromptSuggestions && promptTemplates.length > 0"
                    class="prompt-suggestions"
                >
                    <div
                        v-for="(template, index) in filteredTemplates"
                        :key="template.id"
                        class="suggestion-item"
                        :class="{ active: selectedSuggestionIndex === index }"
                        @click="selectPromptTemplate(template)"
                        @mouseenter="selectedSuggestionIndex = index"
                    >
                        <span class="suggestion-dot"></span>
                        <span class="suggestion-name">{{ template.name || '未命名提示词' }}</span>
                    </div>
                </div>
            </div>
            
            <!-- 操作按钮 -->
            <div class="prompt-actions nodrag">
                <el-button
                    size="small"
                    type="primary"
                    class="save-prompt-btn"
                    :disabled="!text.trim()"
                    @click="showSavePromptDialog = true"
                >
                    保存提示词
                </el-button>
            </div>
      </div>
  
      <!-- 只有输出端口 (Source)，位于右侧 -->
      <Handle 
        id="prompt-source" 
        type="source" 
        :position="Position.Right" 
        :style="{ 
          background: '#409eff', 
          width: '12px', 
          height: '12px', 
          border: '2px solid white',
          borderRadius: '50%',
          cursor: 'crosshair'
        }"
      />
    </div>
    
    <!-- 保存提示词对话框（居中） -->
    <el-dialog
        v-model="showSavePromptDialog"
        title="保存自定义提示词"
        width="700px"
        :show-close="true"
        :close-on-click-modal="true"
        :close-on-press-escape="true"
        :append-to-body="true"
        :modal="true"
        :modal-append-to-body="true"
        :center="true"
        class="centered-save-prompt-dialog"
        @close="savePromptName = ''; savePromptDescription = ''"
    >
        <el-form label-width="120px">
            <el-form-item label="提示词名称" required>
                <el-input
                    v-model="savePromptName"
                    placeholder="请输入提示词名称"
                    maxlength="100"
                    show-word-limit
                    size="large"
                />
            </el-form-item>
            <el-form-item label="提示词内容">
                <el-input
                    :value="text"
                    type="textarea"
                    :rows="8"
                    readonly
                    disabled
                    size="large"
                />
            </el-form-item>
            <el-form-item label="描述（可选）">
                <el-input
                    v-model="savePromptDescription"
                    type="textarea"
                    :rows="4"
                    placeholder="请输入提示词的描述信息"
                    maxlength="200"
                    show-word-limit
                    size="large"
                />
            </el-form-item>
        </el-form>
        <template #footer>
            <el-button size="large" @click="showSavePromptDialog = false">取消</el-button>
            <el-button type="primary" size="large" @click="handleSavePrompt">确认</el-button>
        </template>
    </el-dialog>
  </template>
  
  <script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
  import { Handle, Position, type NodeProps } from '@vue-flow/core';
  import { EditPen } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPromptTemplates, createPromptTemplate, type PromptTemplate } from '@/api/prompt';
  
  const props = defineProps<NodeProps>();
  const text = ref(props.data?.text || '');
  
// 同步输出数据
  watch(text, (val) => {
    props.data.text = val;
  });

// 提示词模板相关
const promptTemplates = ref<PromptTemplate[]>([]);
const showPromptSuggestions = ref(false);
const selectedSuggestionIndex = ref(0);
const promptInputRef = ref<any>(null);

const showSavePromptDialog = ref(false);
const savePromptName = ref('');
const savePromptDescription = ref('');

// 过滤模板（支持 /keyword 搜索）
const filteredTemplates = computed(() => {
    const value = text.value || '';
    const slashIndex = value.lastIndexOf('/');
    if (slashIndex === -1) return promptTemplates.value;
    const keyword = value.slice(slashIndex + 1).trim().toLowerCase();
    if (!keyword) return promptTemplates.value;
    return promptTemplates.value.filter(t =>
        (t.name || '').toLowerCase().includes(keyword) ||
        (t.content || '').toLowerCase().includes(keyword)
    );
});

// 加载提示词模板列表
const loadPromptTemplates = async () => {
    try {
        const res: any = await getPromptTemplates();
        promptTemplates.value = res.data || [];
    } catch (error: any) {
        console.error('加载提示词模板失败:', error);
    }
};

// 处理提示词输入
const handlePromptInput = () => {
    props.data.text = text.value;

    // 有 / 时显示下拉
    const currentValue = text.value;
    const slashIndex = currentValue.lastIndexOf('/');
    if (slashIndex !== -1) {
        // 只有当 / 位于末尾或后面跟关键词时才显示
        showPromptSuggestions.value = filteredTemplates.value.length > 0;
        selectedSuggestionIndex.value = 0;
    } else {
        showPromptSuggestions.value = false;
    }
};

// 处理键盘事件
const handlePromptKeydown = (event: KeyboardEvent) => {
    if (showPromptSuggestions.value && filteredTemplates.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.min(
                selectedSuggestionIndex.value + 1,
                filteredTemplates.value.length - 1
            );
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
        } else if (event.key === 'Enter' && !event.shiftKey) {
            // 选择模板
            const selectedTemplate = filteredTemplates.value[selectedSuggestionIndex.value];
            if (selectedTemplate) {
                event.preventDefault();
                selectPromptTemplate(selectedTemplate);
            }
        } else if (event.key === 'Escape') {
            showPromptSuggestions.value = false;
        }
    }
};

// 选择提示词模板
const selectPromptTemplate = (template: PromptTemplate) => {
    // 将最后一个 /xxx 替换为模板内容
    const currentPrompt = text.value;
    const slashIndex = currentPrompt.lastIndexOf('/');
    const prefix = slashIndex !== -1 ? currentPrompt.slice(0, slashIndex) : currentPrompt;
    text.value = `${prefix}${template.content}`;
    showPromptSuggestions.value = false;
    props.data.text = text.value;

    // 聚焦输入框
    if (promptInputRef.value) {
        promptInputRef.value.focus();
    }
};

// 保存提示词
const handleSavePrompt = async () => {
    if (!savePromptName.value.trim()) {
        ElMessage.warning('请输入提示词名称');
        return;
    }
    if (!text.value.trim()) {
        ElMessage.warning('提示词内容不能为空');
        return;
    }

    try {
        await createPromptTemplate({
            name: savePromptName.value.trim(),
            content: text.value.trim(),
            description: savePromptDescription.value.trim() || undefined
        });
        ElMessage.success('提示词保存成功！');
        showSavePromptDialog.value = false;
        savePromptName.value = '';
        savePromptDescription.value = '';
        await loadPromptTemplates();
    } catch (error: any) {
        ElMessage.error(error.message || '保存失败');
    }
};

// 点击外部关闭提示词列表
const handleClickOutside = (event: MouseEvent) => {
    if (!showPromptSuggestions.value) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.prompt-node')) {
        showPromptSuggestions.value = false;
    }
};

onMounted(() => {
    loadPromptTemplates();
    document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
});
  </script>
  
  <style scoped>
  .prompt-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 320px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.05);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
}

/* VueFlow: allow dragging node except on these elements */
.nodrag {
    cursor: auto;
}

/* 默认隐藏所有 handle，hover 时显示 */
.prompt-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.prompt-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
  }
  
  .node-header {
    background: #f5f7fa;
    border-bottom: 1px solid #eee;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: bold;
    color: #606266;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
  }
  
  .node-content {
    padding: 12px;
  }

.prompt-content {
    position: relative;
    background: #f8f9fa;
    border-radius: 6px;
    padding: 8px;
}

.prompt-input {
    width: 100%;
}

.prompt-input :deep(.el-textarea__inner) {
    min-height: 160px !important;
    line-height: 1.6;
    padding: 8px 10px;
    font-size: 13px;
    background: transparent;
    border: none;
    resize: none;
    color: #333;
}

.prompt-input :deep(.el-textarea__inner):focus {
    border: none;
    box-shadow: none;
}

.prompt-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
    z-index: 1000;
    max-height: 240px;
    overflow-y: auto;
    margin-top: 6px;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    transition: background-color 0.15s;
}

.suggestion-item:hover,
.suggestion-item.active {
    background-color: #f5f7fa;
}

.suggestion-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #409eff;
    flex-shrink: 0;
}

.suggestion-name {
    font-size: 13px;
    color: #303133;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
}

.save-prompt-btn {
    font-size: 12px;
    padding: 4px 12px;
    height: auto;
}

/* 居中保存提示词对话框样式 */
.centered-save-prompt-dialog :deep(.el-dialog) {
    margin: 0 !important;
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    max-height: 90vh !important;
    display: flex !important;
    flex-direction: column !important;
}
  </style>