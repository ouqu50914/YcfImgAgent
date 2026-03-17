<template>
    <div class="prompt-node">
      <div class="node-header">
        <el-icon><EditPen /></el-icon>
        <span>提示词输入</span>
      </div>
      
      <div class="node-content">
            <div class="prompt-content nodrag">
                <div class="prompt-input-wrap" @wheel.stop>
                    <div ref="mirrorRef" class="prompt-mirror">
                        <div class="prompt-mirror-inner" v-html="highlightedHtml" />
                    </div>
                    <textarea
                        ref="promptInputRef"
                        v-model="text"
                        class="prompt-input prompt-input-overlay"
                        placeholder="请输入提示词..."
                        maxlength="2000"
                        rows="4"
                        @compositionstart="isComposing = true"
                        @compositionend="handleCompositionEnd"
                        @input="handlePromptInput"
                        @keydown="handlePromptKeydown"
                    />
                </div>
                
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

                <!-- 图片别名 @ 图列表 -->
                <div
                    v-if="showAliasSuggestions && aliasSuggestions.length > 0"
                    class="prompt-suggestions alias-suggestions"
                >
                    <div
                        v-for="(item, index) in aliasSuggestions"
                        :key="item.key"
                        class="suggestion-item"
                        :class="{ active: selectedAliasIndex === index }"
                        @click="selectImageAlias(item)"
                        @mouseenter="selectedAliasIndex = index"
                    >
                        <span class="suggestion-dot"></span>
                        <span class="suggestion-name">{{ '@' + item.alias }}</span>
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
import { ref, watch, computed, onMounted, onUnmounted, inject, nextTick } from 'vue';
import { Handle, Position, type NodeProps, useVueFlow } from '@vue-flow/core';
import { EditPen } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPromptTemplates, createPromptTemplate, type PromptTemplate } from '@/api/prompt';

// 声明 Vue Flow 会注入的事件，避免控制台出现 updateNodeInternals 的警告
defineEmits<{
  updateNodeInternals: [];
}>();

type ImageAliasStore = {
    getOrCreateAlias: (imageKey: string) => string;
    getAllAliases: () => { key: string; alias: string }[];
};

type MediaAliasStore = {
    getOrCreateVideoAlias: (key: string) => string;
    getOrCreateAudioAlias: (key: string) => string;
};

const props = defineProps<NodeProps>();
const text = ref(props.data?.text || '');

const { getEdges, findNode } = useVueFlow();

// 当内部输入变化时，同步到节点数据
watch(text, (val) => {
  props.data.text = val;
});

// 当从历史记录 / 模板加载时，节点 data.text 可能先于组件创建好，这里反向同步到本地 text
watch(
  () => props.data?.text,
  (val) => {
    if (typeof val === 'string' && val !== text.value) {
      text.value = val;
    }
  },
  { immediate: true }
);

// 是否处于输入法组合输入阶段（中文拼音等）
const isComposing = ref(false);

// 提示词模板相关
const promptTemplates = ref<PromptTemplate[]>([]);
const showPromptSuggestions = ref(false);
const selectedSuggestionIndex = ref(0);
const promptInputRef = ref<HTMLTextAreaElement | null>(null);

// 图片别名 @图1 自动补全
const imageAliasStore = inject<ImageAliasStore | null>('imageAliasStore', null);
// 视频 / 音频别名自动补全
const mediaAliasStore = inject<MediaAliasStore | null>('mediaAliasStore', null);
const showAliasSuggestions = ref(false);
const aliasSuggestions = ref<{ key: string; alias: string }[]>([]);
const selectedAliasIndex = ref(0);

// 镜像高亮：@图1、@图2 等显示为蓝色
const mirrorRef = ref<HTMLElement | null>(null);
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}
const highlightedHtml = computed(() => {
    const raw = text.value || '';
    const escaped = escapeHtml(raw);
    // 先高亮 @图1、@图2（保留 @ 并蓝色显示）
    let out = escaped.replace(/@(图\d+)/g, '<span class="prompt-ref">@$1</span>');
    // 再高亮未带 @ 的 图1、图2（仅显示高亮，不改变实际值）
    out = out.replace(/(^|<br>|[\s\u00A0])(图\d+)(?=[\s\u00A0，。、；：!?]|$|<br>)/g, '$1<span class="prompt-ref">$2</span>');
    return out;
});

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

// 计算与当前提示词节点通过同一生图 / 视频生成节点关联的资源别名列表
// 图片：与提示词节点通过同一「生图节点」或「视频生成节点」相连时，使用图别名（图1、图2）
// 视频/音频参考：与提示词节点通过同一「视频生成节点」相连时，使用自动生成的“视频1、音频1”等别名
const getRelatedResourceAliases = (): { key: string; alias: string }[] => {
    const result: { key: string; alias: string }[] = [];

    const edges = getEdges.value || [];
    if (!Array.isArray(edges) || edges.length === 0) return result;

    // ---------- 图片：通过同一生图节点 / 视频生成节点 关联 ----------
    if (imageAliasStore) {
        const bridgeNodeIds = new Set<string>(); // 生图节点 + 视频生成节点

        for (const edge of edges) {
            if (!edge?.source || !edge?.target) continue;
            if (edge.source !== props.id) continue;
            const targetNode = findNode(edge.target);
            if (targetNode && (targetNode.type === 'dream' || targetNode.type === 'video')) {
                bridgeNodeIds.add(targetNode.id);
            }
        }

        if (bridgeNodeIds.size > 0) {
            const aliasMap: Record<string, string> = {};

            for (const edge of edges) {
                if (!edge?.source || !edge?.target) continue;
                if (!bridgeNodeIds.has(edge.target)) continue;

                const imageNode = findNode(edge.source);
                if (!imageNode || imageNode.type !== 'image') continue;

                const data: any = imageNode.data || {};
                const key: string | undefined =
                    data.imageKey || data.originalImageUrl || data.imageUrl;
                if (!key) continue;

                let alias: string | undefined = data.imageAlias;
                if (!alias) {
                    alias = imageAliasStore.getOrCreateAlias(key);
                    data.imageAlias = alias;
                    data.imageKey = key;
                }

                if (!aliasMap[key]) {
                    aliasMap[key] = alias;
                }
            }

            for (const [key, alias] of Object.entries(aliasMap)) {
                result.push({ key, alias });
            }
        }
    }

    // ---------- 视频 / 音频参考节点：通过同一视频生成节点关联 ----------
    const videoNodeIds = new Set<string>();

    for (const edge of edges) {
        if (!edge?.source || !edge?.target) continue;
        if (edge.source !== props.id) continue;
        const targetNode = findNode(edge.target);
        if (targetNode && targetNode.type === 'video') {
            videoNodeIds.add(targetNode.id);
        }
    }

    if (videoNodeIds.size > 0) {
        const seenKeys = new Set<string>(result.map(r => r.key));

        for (const edge of edges) {
            if (!edge?.source || !edge?.target) continue;
            if (!videoNodeIds.has(edge.target)) continue;

            const node = findNode(edge.source);
            if (!node) continue;

            if (node.type !== 'videoRef' && node.type !== 'audioRef') continue;

            const data: any = node.data || {};
            const key: string = node.id;

            // 自动生成或复用别名，优先从节点 data.resourceAlias 读取
            let alias: string | undefined = (data.resourceAlias as string | undefined)?.trim();
            if (!alias && mediaAliasStore) {
                if (node.type === 'videoRef') {
                    alias = mediaAliasStore.getOrCreateVideoAlias(key);
                } else {
                    alias = mediaAliasStore.getOrCreateAudioAlias(key);
                }
                data.resourceAlias = alias;
            }

            if (!alias) continue;

            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                result.push({ key, alias });
            }
        }
    }

    return result;
};

// 处理提示词输入
const handlePromptInput = () => {
    // 输入法组合过程中不做任何模板 / 别名联想与文本重写，避免中文输入导致的重复 / 光标错位
    if (isComposing.value) {
        return;
    }

    props.data.text = text.value;

    const currentValue = text.value || '';
    const slashIndex = currentValue.lastIndexOf('/');
    const atIndex = currentValue.lastIndexOf('@');

    // / 模板提示
    if (slashIndex !== -1 && (slashIndex > atIndex)) {
        showPromptSuggestions.value = filteredTemplates.value.length > 0;
        selectedSuggestionIndex.value = 0;
    } else {
        showPromptSuggestions.value = false;
    }

    // @ 资源名提示（图片别名 / 视频参考 / 音频参考）
    if (atIndex !== -1 && atIndex >= 0) {
        const textareaEl = getTextareaEl();
        const cursorPos = textareaEl?.selectionStart ?? currentValue.length;

        // 只有当光标在该 @ 之后时，才认为用户正在输入别名
        if (cursorPos >= atIndex + 1) {
            const rawKeyword = currentValue.slice(atIndex + 1, cursorPos);
            const keyword = rawKeyword.trim();

            const all = getRelatedResourceAliases();
            const list = all.filter(item =>
                !keyword ||
                item.alias.includes(keyword)
            );
            showAliasSuggestions.value = list.length > 0;
            aliasSuggestions.value = list;
            selectedAliasIndex.value = 0;
        } else {
            showAliasSuggestions.value = false;
            aliasSuggestions.value = [];
        }
    } else {
        showAliasSuggestions.value = false;
        aliasSuggestions.value = [];
    }
};

// 组合输入结束时再统一执行一次输入处理逻辑
const handleCompositionEnd = () => {
    isComposing.value = false;
    handlePromptInput();
};

// 处理键盘事件
const handlePromptKeydown = (event: KeyboardEvent) => {
    // 图片别名选择优先
    if (showAliasSuggestions.value && aliasSuggestions.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedAliasIndex.value = Math.min(
                selectedAliasIndex.value + 1,
                aliasSuggestions.value.length - 1
            );
            return;
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedAliasIndex.value = Math.max(selectedAliasIndex.value - 1, 0);
            return;
        } else if (event.key === 'Enter' && !event.shiftKey) {
            const selected = aliasSuggestions.value[selectedAliasIndex.value];
            if (selected) {
                event.preventDefault();
                selectImageAlias(selected);
                return;
            }
        } else if (event.key === 'Escape') {
            showAliasSuggestions.value = false;
            return;
        }
    }

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

// 图片别名选择，将最后一个 @xxx 替换为 @图1 之类
const selectImageAlias = (item: { key: string; alias: string }) => {
    const currentPrompt = text.value || '';
    const atIndex = currentPrompt.lastIndexOf('@');
    const aliasText = `@${item.alias}`;

    if (atIndex === -1) {
        text.value = `${currentPrompt}${currentPrompt ? ' ' : ''}${aliasText}`;
    } else {
        const before = currentPrompt.slice(0, atIndex);
        const textareaEl = getTextareaEl();
        const cursorPos = textareaEl?.selectionStart ?? currentPrompt.length;
        const after = currentPrompt.slice(cursorPos);
        // 始终用 @图1 形式替换，保留 @ 符号
        text.value = `${before}${aliasText}${after}`;
    }

    props.data.text = text.value;
    showAliasSuggestions.value = false;

    nextTick(() => {
        const textareaEl = getTextareaEl();
        if (textareaEl) {
            const pos = text.value.lastIndexOf(item.alias) + item.alias.length + 1; // 包含 @
            textareaEl.setSelectionRange(pos, pos);
            textareaEl.focus();
        }
    });
};

const getTextareaEl = (): HTMLTextAreaElement | null => {
    const el = promptInputRef.value;
    if (!el) return null;
    return el instanceof HTMLTextAreaElement ? el : null;
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
        console.error('[PromptNode] 保存提示词失败', error);
        // 统一错误提示交给全局拦截器，这里仅在无响应时兜底
        if (!(error as any)?.response) {
            ElMessage.error('保存失败，请稍后重试');
        }
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

const PROMPT_INPUT_MIN_H = 120;
const PROMPT_INPUT_MAX_H = 360;

function syncMirrorToTextarea() {
    nextTick(() => {
        const ta = getTextareaEl();
        const mirror = mirrorRef.value;
        if (ta && mirror) {
            const inner = mirror.querySelector('.prompt-mirror-inner') as HTMLElement;
            if (inner) inner.style.minHeight = `${ta.scrollHeight}px`;
            mirror.scrollTop = ta.scrollTop;
        }
    });
}

function fitTextareaHeight() {
    nextTick(() => {
        const ta = getTextareaEl();
        if (!ta) return;
        ta.style.height = 'auto';
        const h = Math.min(PROMPT_INPUT_MAX_H, Math.max(PROMPT_INPUT_MIN_H, ta.scrollHeight));
        ta.style.height = `${h}px`;
        syncMirrorToTextarea();
    });
}

watch(text, () => {
    syncMirrorToTextarea();
    fitTextareaHeight();
});

onMounted(() => {
    loadPromptTemplates();
    document.addEventListener('click', handleClickOutside);
    nextTick(() => {
        const ta = getTextareaEl();
        const mirror = mirrorRef.value;
        if (ta && mirror) {
            ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; });
            fitTextareaHeight();
            syncMirrorToTextarea();
        }
    });
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
});
  </script>
  
  <style scoped>
  .prompt-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 320px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
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
    background: #3a3a3f;
    border-bottom: 1px solid #404040;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: bold;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
  }
  
  .node-content {
    padding: 14px 16px;
    color: #e0e0e0;
  }

.prompt-content {
    position: relative;
    background: transparent;
    border-radius: 6px;
    padding: 8px;
}

.prompt-input-wrap {
    position: relative;
    min-height: 120px;
    max-height: 360px;
}

.prompt-mirror {
    position: absolute;
    /* 与 textarea 的 1px 边框一致，保证内容区域对齐 */
    inset: 1px;
    z-index: 0;
    overflow-y: auto;
    pointer-events: none;
    border-radius: 7px; /* textarea 8px - 1px 边框 */
}

.prompt-mirror-inner {
    padding: 8px 10px;
    font-size: 13px;
    line-height: 1.6;
    font-family: inherit;
    letter-spacing: normal;
    white-space: pre-wrap;
    word-break: break-word;
    color: #e0e0e0;
    box-sizing: border-box;
}

/* 不加 font-weight，保证与 textarea 同字宽，光标才能对齐 */
.prompt-mirror-inner :deep(.prompt-ref) {
    color: var(--color-primary, #409eff);
}

.prompt-input {
    width: 100%;
}

.prompt-input-overlay {
    position: relative;
    z-index: 1;
    display: block;
    width: 100%;
    min-height: 120px;
    max-height: 360px;
    overflow-y: auto;
    line-height: 1.6;
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
    letter-spacing: normal;
    box-sizing: border-box;
    background: transparent !important;
    border: 1px solid #404040;
    border-radius: 8px;
    resize: none;
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    caret-color: #e0e0e0;
    outline: none;
}

.prompt-input-overlay::placeholder {
    color: var(--text-subtle);
}

.prompt-input-overlay:focus {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.prompt-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #252525;
    border: 1px solid #404040;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.6);
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
    background-color: #333333;
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
    color: #b0b0b0;
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