<template>
    <div class="dream-node">
        <!-- 内容区域 - 参考截图布局 -->
        <div class="node-content">
            <!-- 左侧：输入区域 -->
            <div class="input-section">
                <div class="section-title">
                    <span class="arrow-icon">→</span>
                    <span>输入</span>
                </div>
                
                <!-- 提示词输入区域 -->
                <div class="prompt-wrapper" @mousedown.stop @mousemove.stop>
                    <div class="prompt-content" style="position: relative;">
                        <el-input
                            ref="promptInputRef"
                            v-model="prompt"
                            type="textarea"
                            :autosize="{ minRows: 3, maxRows: 8 }"
                            :placeholder="props.data?.isVariation ? '变体生成：将使用上游节点的提示词和图片' : '输入提示词,或输入 / 从已有提示词中选择'"
                            class="prompt-input"
                            maxlength="500"
                            :disabled="isExecuted"
                            @mousedown.stop
                            @click.stop
                            @input="handlePromptInput"
                            @keydown="handlePromptKeydown"
                        />
                        <!-- 提示词列表下拉框 -->
                        <div
                            v-if="showPromptSuggestions && promptTemplates.length > 0"
                            class="prompt-suggestions"
                        >
                            <div
                                v-for="(template, index) in promptTemplates"
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
                    <!-- 按钮组 -->
                    <div class="prompt-actions" v-if="!isExecuted">
                        <el-button
                            size="small"
                            type="primary"
                            class="save-prompt-btn"
                            :disabled="!prompt.trim()"
                            @click="showSavePromptDialog = true"
                        >
                            保存提示词
                        </el-button>
                        <el-button
                            size="small"
                            type="danger"
                            class="polish-btn"
                            :loading="polishing"
                            @click="handlePolish"
                        >
                            + AI润色
                        </el-button>
                    </div>
                </div>

                <!-- 图片上传区域（支持多张） -->
                <div class="upload-section">
                    <div class="upload-content">
                        <!-- 图片缩略图列表 -->
                        <div v-if="uploadedImages.length > 0" class="image-thumbnails">
                            <div
                                v-for="(img, index) in uploadedImages"
                                :key="index"
                                class="thumbnail-item"
                            >
                                <el-image
                                    :src="img.url"
                                    fit="cover"
                                    class="thumbnail-img"
                                    :preview-src-list="[]"
                                    :hide-on-click-modal="false"
                                    @click="() => handleThumbnailClick(img.url)"
                                />
                                <el-button
                                    size="small"
                                    type="danger"
                                    circle
                                    class="remove-thumb-btn"
                                    @click="removeImage(index)"
                                >
                                    <el-icon><Close /></el-icon>
                                </el-button>
                            </div>
                        </div>
                    </div>
                    <!-- 上传按钮始终在最下面 -->
                    <el-upload
                        v-if="!isExecuted"
                        class="upload-demo"
                        :auto-upload="false"
                        :on-change="handleImageChange"
                        :on-remove="handleImageRemove"
                        :file-list="uploadedImages"
                        :show-file-list="false"
                        accept="image/*"
                        multiple
                    >
                        <el-button size="small" type="default" plain class="upload-btn">
                            <el-icon><Upload /></el-icon>
                            上传图片
                        </el-button>
                    </el-upload>
                </div>
            </div>

            <!-- 右侧：参数设置 -->
            <div class="params-section">
                <div class="section-title">
                    <el-icon><Picture /></el-icon>
                    图片
                </div>
                
                <!-- 模型选择 -->
                <div class="param-item">
                    <div class="param-label">模型</div>
                    <el-select v-model="apiType" placeholder="选择模型" size="small" class="param-select model-select" :disabled="isExecuted">
                        <el-option label="Seedream" value="dream" />
                        <el-option label="Nano" value="nano" />
                    </el-select>
                </div>

                <!-- 生成数量 -->
                <div class="param-item">
                    <div class="param-label">生成数量</div>
                    <el-select v-model="numImages" placeholder="生成数量" size="small" class="param-select" :disabled="isExecuted">
                        <el-option label="1" :value="1" />
                        <el-option label="2" :value="2" />
                        <el-option label="3" :value="3" />
                        <el-option label="4" :value="4" />
                    </el-select>
                </div>

                <!-- 分辨率设置 -->
                <div class="param-item">
                    <div class="param-label">分辨率</div>
                    <el-select v-model="quality" placeholder="画质" size="small" class="param-select" :disabled="isExecuted">
                        <el-option label="1K" value="1K" />
                        <el-option label="2K" value="2K" />
                        <el-option label="4K" value="4K" />
                        <el-option label="标准画质" value="standard" />
                    </el-select>
                </div>

                <!-- 图片比例 -->
                <div class="param-item">
                    <div class="param-label">图片比例</div>
                    <el-select 
                        v-model="size" 
                        placeholder="比例" 
                        size="small" 
                        class="param-select"
                        :disabled="isExecuted || quality !== 'standard'"
                    >
                        <el-option label="1:1" value="2048x2048" />
                        <el-option label="4:3" value="2304x1728" />
                        <el-option label="3:4" value="1728x2304" />
                        <el-option label="16:9" value="2560x1440" />
                        <el-option label="9:16" value="1440x2560" />
                        <el-option label="3:2" value="2496x1664" />
                        <el-option label="2:3" value="1664x2496" />
                        <el-option label="21:9" value="3024x1296" />
                        <el-option label="Auto" value="auto" />
                    </el-select>
                    <div v-if="quality !== 'standard'" class="param-hint">
                        <el-icon><InfoFilled /></el-icon>
                        <span>使用{{ quality }}模式，请在提示词中描述图片宽高比</span>
                    </div>
                    <div v-else class="param-hint">
                        <el-icon><InfoFilled /></el-icon>
                        <span>使用像素模式，当前尺寸：{{ size === 'auto' ? '自动' : size }}</span>
                    </div>
                </div>

                <!-- 执行按钮 -->
                <el-button
                    v-if="!isExecuted"
                    type="primary"
                    size="default"
                    class="execute-btn"
                    :loading="loading"
                    @click="handleGenerate"
                >
                    <el-icon><VideoPlay /></el-icon>
                    执行
                </el-button>
                <div v-else class="executed-status">
                    <el-icon><CircleCheck /></el-icon>
                    <span>已执行</span>
                </div>
            </div>
        </div>

        <!-- 节点连接点 (Handle) -->
        <Handle 
            id="target" 
            type="target" 
            :position="Position.Left" 
            :style="{ 
                background: '#555', 
                width: '12px', 
                height: '12px', 
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
        <Handle 
            id="source" 
            type="source" 
            :position="Position.Right" 
            :style="{ 
                background: '#555', 
                width: '12px', 
                height: '12px', 
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
    </div>

    <!-- 全屏图片预览 -->
    <el-dialog
        v-model="showFullscreenPreview"
        :show-close="true"
        :close-on-click-modal="true"
        :close-on-press-escape="true"
        :append-to-body="true"
        :modal="true"
        :modal-append-to-body="true"
        width="100%"
        top="0"
        class="fullscreen-preview-dialog"
        @close="showFullscreenPreview = false"
    >
        <div class="fullscreen-preview-container" @click="showFullscreenPreview = false">
            <img :src="previewImageUrl" class="fullscreen-image" alt="预览图片" />
        </div>
    </el-dialog>

    <!-- 保存提示词对话框（居中） -->
    <el-dialog
        v-model="showSavePromptDialog"
        title="保存自定义提示词"
        width="800px"
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
                    placeholder="请输入提示词名称，例如：未命名提示词"
                    maxlength="100"
                    show-word-limit
                    size="large"
                />
            </el-form-item>
            <el-form-item label="提示词内容">
                <el-input
                    :value="prompt"
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Picture, Upload, Close, VideoPlay, InfoFilled, CircleCheck } from '@element-plus/icons-vue';
import { generateImage } from '../../api/image';
import { optimizePrompt, getPromptTemplates, createPromptTemplate, type PromptTemplate } from '../../api/prompt';
import { uploadImage } from '../../api/upload';
import { ElMessage } from 'element-plus';
import type { UploadFile } from 'element-plus';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

// 定义 Vue Flow 节点所需的 props
const props = defineProps<NodeProps>();

const { findNode, getEdges, addNodes, addEdges, getNodes } = useVueFlow();

const prompt = ref(props.data?.prompt || '');
const size = ref('2048x2048'); // 默认使用推荐的1:1尺寸
const apiType = ref<'dream' | 'nano'>('dream');
const quality = ref('2K');
const numImages = ref(1);
const loading = ref(false);
const polishing = ref(false);
const imageUrl = ref(props.data?.imageUrl || '');
const imageUrls = ref<string[]>(props.data?.imageUrls || []); // 支持多图结果（用于传递给下游节点和创建 ImageNode）
const uploadedImages = ref<Array<{ url: string; file: File }>>([]);
const showFullscreenPreview = ref(false);
const previewImageUrl = ref('');
const isExecuted = ref(false); // 标记节点是否已执行

// 提示词模板相关
const promptTemplates = ref<PromptTemplate[]>([]);
const showPromptSuggestions = ref(false);
const selectedSuggestionIndex = ref(0);
const promptInputRef = ref<any>(null);
const showSavePromptDialog = ref(false);
const savePromptName = ref('');
const savePromptDescription = ref('');

// 如果是变体节点，初始化时使用传入的数据
if (props.data?.isVariation) {
    if (props.data.imageUrl && !imageUrl.value) {
        imageUrl.value = props.data.imageUrl;
    }
    if (props.data.imageUrls && props.data.imageUrls.length > 0 && imageUrls.value.length === 0) {
        imageUrls.value = props.data.imageUrls;
    }
    if (props.data.prompt && !prompt.value) {
        prompt.value = props.data.prompt;
    }
    // 变体节点的 imageUrl 是参考图片，不是执行结果，不应该标记为已执行
    // 只有在真正执行完成后才标记为已执行
}

// 如果节点已有执行结果，标记为已执行
// 注意：变体节点的 imageUrl 是参考图片，不是执行结果，所以需要排除变体节点
if (!props.data?.isVariation && (props.data?.imageUrl || (props.data?.imageUrls && props.data.imageUrls.length > 0))) {
    isExecuted.value = true;
}

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});

// 处理图片上传（支持多张）
const handleImageChange = (file: UploadFile) => {
    if (file.raw) {
        const url = URL.createObjectURL(file.raw);
        uploadedImages.value.push({
            url,
            file: file.raw
        });
    }
};

// 移除图片
const handleImageRemove = (file: UploadFile) => {
    if (!file.raw) return;
    const index = uploadedImages.value.findIndex(img => img.file === file.raw);
    if (index !== -1 && uploadedImages.value[index]) {
        URL.revokeObjectURL(uploadedImages.value[index].url);
        uploadedImages.value.splice(index, 1);
    }
};

// 移除指定索引的图片
const removeImage = (index: number) => {
    if (uploadedImages.value[index]) {
        URL.revokeObjectURL(uploadedImages.value[index].url);
        uploadedImages.value.splice(index, 1);
    }
};

// 点击缩略图预览
const handleThumbnailClick = (url: string) => {
    previewImageUrl.value = url;
    showFullscreenPreview.value = true;
};

// 加载提示词模板列表
const loadPromptTemplates = async () => {
    try {
        const res: any = await getPromptTemplates();
        if (res.data) {
            promptTemplates.value = res.data;
        }
    } catch (error: any) {
        console.error('加载提示词模板失败:', error);
    }
};

// 处理提示词输入
const handlePromptInput = () => {
    // 检测是否输入了斜杠
    const currentValue = prompt.value;
    const lastChar = currentValue[currentValue.length - 1];
    if (lastChar === '/') {
        // 显示提示词列表
        if (promptTemplates.value.length > 0) {
            showPromptSuggestions.value = true;
            selectedSuggestionIndex.value = 0;
        } else {
            // 如果没有提示词，加载一次
            loadPromptTemplates().then(() => {
                if (promptTemplates.value.length > 0) {
                    showPromptSuggestions.value = true;
                    selectedSuggestionIndex.value = 0;
                }
            });
        }
    } else {
        // 如果输入的不是斜杠，隐藏提示词列表
        showPromptSuggestions.value = false;
    }
};

// 处理键盘事件
const handlePromptKeydown = (event: KeyboardEvent) => {
    if (showPromptSuggestions.value && promptTemplates.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.min(
                selectedSuggestionIndex.value + 1,
                promptTemplates.value.length - 1
            );
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
        } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const selectedTemplate = promptTemplates.value[selectedSuggestionIndex.value];
            if (selectedTemplate) {
                selectPromptTemplate(selectedTemplate);
            }
        } else if (event.key === 'Escape') {
            showPromptSuggestions.value = false;
        }
    }
};

// 选择提示词模板
const selectPromptTemplate = (template: PromptTemplate) => {
    // 移除最后的斜杠，然后插入提示词内容
    let currentPrompt = prompt.value;
    if (currentPrompt.endsWith('/')) {
        currentPrompt = currentPrompt.slice(0, -1);
    }
    // 插入提示词内容
    prompt.value = currentPrompt + template.content;
    showPromptSuggestions.value = false;
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
    if (!prompt.value.trim()) {
        ElMessage.warning('提示词内容不能为空');
        return;
    }

    try {
        await createPromptTemplate({
            name: savePromptName.value.trim(),
            content: prompt.value.trim(),
            description: savePromptDescription.value.trim() || undefined
        });
        ElMessage.success('提示词保存成功！');
        showSavePromptDialog.value = false;
        savePromptName.value = '';
        savePromptDescription.value = '';
        // 重新加载提示词列表
        await loadPromptTemplates();
    } catch (error: any) {
        ElMessage.error(error.message || '保存失败');
    }
};

// 点击外部关闭提示词列表
const handleClickOutside = (event: MouseEvent) => {
    if (showPromptSuggestions.value && promptInputRef.value) {
        const target = event.target as HTMLElement;
        if (!promptInputRef.value.$el?.contains(target)) {
            showPromptSuggestions.value = false;
        }
    }
};

// 处理润色
const handlePolish = async () => {
    if (!prompt.value.trim()) {
        ElMessage.warning('请先输入提示词');
        return;
    }
    
    polishing.value = true;
    try {
        const res: any = await optimizePrompt({
            prompt: prompt.value,
            apiType: 'dream'
        });
        
        if (res.data && res.data.optimized) {
            prompt.value = res.data.optimized;
            ElMessage.success('提示词润色成功！');
        } else if (res.optimized) {
            prompt.value = res.optimized;
            ElMessage.success('提示词润色成功！');
        } else {
            ElMessage.warning('润色功能暂未实现');
        }
    } catch (error: any) {
        console.log('润色API调用失败:', error);
        ElMessage.warning('润色功能暂未实现，请稍后再试');
    } finally {
        polishing.value = false;
    }
};

// 组件挂载时加载提示词列表
onMounted(() => {
    loadPromptTemplates();
    document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
});



// 生成图片
const handleGenerate = async () => {
    loading.value = true;
    try {
        // 1. 查找连接到当前节点(target=props.id)的所有连线（支持多个上游节点）
        const edges = getEdges.value;
        const targetEdges = edges.filter((e) => e.target === props.id);

        // 2. 获取所有上游节点的数据（图片和提示词）
        let upstreamImageUrl = '';
        let upstreamImageUrls: string[] = [];
        let upstreamPrompt = '';

        // 收集所有上游节点的图片
        targetEdges.forEach((edge) => {
            const sourceNode = findNode(edge.source);
            if (sourceNode && sourceNode.data) {
                // 收集图片：优先使用 imageUrls，否则使用 imageUrl
                if (sourceNode.data.imageUrls && Array.isArray(sourceNode.data.imageUrls) && sourceNode.data.imageUrls.length > 0) {
                    // 如果是多图，添加到数组（过滤掉 undefined）
                    const validUrls = sourceNode.data.imageUrls.filter((url: any): url is string => !!url);
                    upstreamImageUrls.push(...validUrls);
                } else if (sourceNode.data.imageUrl) {
                    // 如果是单图，添加到数组
                    upstreamImageUrls.push(sourceNode.data.imageUrl);
                }
                
                // 获取上游节点的提示词（使用第一个上游节点的提示词）
                if (!upstreamPrompt) {
                    if (sourceNode.data.prompt) {
                        upstreamPrompt = sourceNode.data.prompt;
                    } else if (sourceNode.data.text) {
                        upstreamPrompt = sourceNode.data.text;
                    }
                }
            }
        });

        // 处理收集到的图片
        if (upstreamImageUrls.length > 0) {
            // 如果有多个图片，使用多图模式
            if (upstreamImageUrls.length === 1 && upstreamImageUrls[0]) {
                upstreamImageUrl = upstreamImageUrls[0];
            }
            console.log(`🔗 检测到 ${targetEdges.length} 个上游节点，共 ${upstreamImageUrls.length} 张图片:`, {
                imageUrl: upstreamImageUrl,
                imageUrls: upstreamImageUrls,
                prompt: upstreamPrompt
            });
        }

        // 3. 如果是变体生成，优先使用上游节点的数据
        const isVariation = props.data?.isVariation;
        if (isVariation) {
            // 变体生成：使用上游的图片和提示词
            if (upstreamImageUrl && !imageUrl.value && uploadedImages.value.length === 0) {
                imageUrl.value = upstreamImageUrl;
                console.log('变体生成：使用上游图片', upstreamImageUrl);
            }
            if (upstreamImageUrls.length > 0 && imageUrls.value.length === 0 && uploadedImages.value.length === 0) {
                imageUrls.value = upstreamImageUrls;
                console.log('变体生成：使用上游多图', upstreamImageUrls);
            }
            if (upstreamPrompt && !prompt.value) {
                prompt.value = upstreamPrompt;
                console.log('变体生成：使用上游提示词', upstreamPrompt);
            }
        }

        // 4. 确定最终使用的提示词和图片
        let finalPrompt = prompt.value || upstreamPrompt; // 优先使用当前输入，否则使用上游

        // 5. 校验：至少需要提示词或图片之一
        const hasImage = uploadedImages.value.length > 0 || imageUrl.value || upstreamImageUrl || upstreamImageUrls.length > 0;
        if (!finalPrompt && !hasImage) {
            ElMessage.warning('请输入提示词或上传图片，或连接上游节点');
            loading.value = false;
            return;
        }

        // 解析尺寸
        let width = 2048; // 默认使用推荐的1:1尺寸
        let height = 2048;
        if (size.value !== 'auto') {
            const dimensions = size.value.split('x').map(Number);
            width = dimensions[0] || 2048;
            height = dimensions[1] || 2048;
        }

        // 6. 处理参考图片：优先使用上传的图片，否则使用上游节点的图片
        let referenceImageUrl = '';
        let referenceImageUrls: string[] = [];
        const hasMultipleReferenceImages = uploadedImages.value.length > 1;
        
        // 如果没有上传图片，但上游节点有图片，使用上游图片
        if (uploadedImages.value.length === 0) {
            if (upstreamImageUrls.length > 1) {
                // 多个上游节点或多个图片，使用多图模式
                referenceImageUrls = upstreamImageUrls;
                console.log(`使用上游 ${upstreamImageUrls.length} 张图片作为参考:`, referenceImageUrls);
            } else if (upstreamImageUrls.length === 1 && upstreamImageUrls[0]) {
                // 单个图片
                referenceImageUrl = upstreamImageUrls[0];
                console.log('使用上游单图作为参考:', referenceImageUrl);
            } else if (imageUrl.value) {
                // 变体节点可能已经有图片URL
                referenceImageUrl = imageUrl.value;
                console.log('使用节点已有图片作为参考:', referenceImageUrl);
            }
        }
        
        if (uploadedImages.value.length > 0) {
            try {
                console.log(`开始上传参考图片... (${uploadedImages.value.length}张)`);
                
                if (hasMultipleReferenceImages) {
                    // 多图上传
                    const uploadPromises = uploadedImages.value.map(img => uploadImage(img.file));
                    const uploadResults = await Promise.all(uploadPromises);
                    
                    referenceImageUrls = uploadResults
                        .map((res: any) => res.data?.url)
                        .filter((url: string) => url)
                        .map((url: string) => 
                            url.startsWith('http') ? url : `${window.location.origin}${url}`
                        );
                    
                    console.log(`参考图片上传成功: ${referenceImageUrls.length}张`, referenceImageUrls);
                } else if (uploadedImages.value[0]) {
                    // 单图上传
                    const uploadRes: any = await uploadImage(uploadedImages.value[0].file);
                    if (uploadRes.data && uploadRes.data.url) {
                        referenceImageUrl = uploadRes.data.url.startsWith('http')
                            ? uploadRes.data.url
                            : `${window.location.origin}${uploadRes.data.url}`;
                        console.log('参考图片上传成功:', referenceImageUrl);
                    } else {
                        console.warn('图片上传返回格式异常:', uploadRes);
                        ElMessage.warning('图片上传失败，使用文生图模式');
                    }
                }
            } catch (error: any) {
                console.error('图片上传失败:', error);
                ElMessage.warning('图片上传失败，使用文生图模式');
            }
        }

        // 确定使用的模式
        const useQualityMode = quality.value !== 'standard';
        const modeInfo = useQualityMode 
            ? `方式1（分辨率模式）: ${quality.value}，请在提示词中描述宽高比`
            : `方式2（像素模式）: ${width}x${height}`;
        
        // 构建请求参数
        const requestParams: any = {
            apiType: apiType.value,
            prompt: finalPrompt || '基于上传的图片生成',
            numImages: numImages.value,
            imageUrl: hasMultipleReferenceImages ? undefined : (referenceImageUrl || undefined),
            imageUrls: hasMultipleReferenceImages && referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        };

        // 根据模式决定传递哪些参数
        if (useQualityMode) {
            // 方式1：只传递quality，不传递width/height
            requestParams.quality = quality.value;
            console.log(`[前端] 使用方式1（分辨率模式）: ${quality.value}`);
            console.log(`[前端] 提示：请在提示词中描述图片宽高比，例如："1:1的正方形图片"、"16:9的横屏图片"等`);
        } else {
            // 方式2：传递width/height，不传递quality
            requestParams.width = width;
            requestParams.height = height;
            console.log(`[前端] 使用方式2（像素模式）: ${width}x${height}`);
        }
        
        console.log('发送生图请求，参数:', {
            ...requestParams,
            mode: modeInfo
        });

        const res: any = await generateImage(requestParams);
        
        console.log('👉 后端原始返回:', res);
        // 后端返回格式: { message: "任务提交成功", data: { image_url: "...", all_images: [...] } }
        if (res.data) {
            // 处理多图结果
            const allImages = res.data.all_images || (res.data.image_url ? [res.data.image_url] : []);
            
            if (allImages.length > 0) {
                // 转换所有图片URL为完整URL
                const fullUrls = allImages.map((url: string) => {
                    if (url.startsWith('http')) return url;
                    // 处理相对路径
                    if (url.startsWith('/uploads/')) {
                        return `${window.location.origin}${url}`;
                    }
                    return `${window.location.origin}/uploads/${url}`;
                });
                
                imageUrls.value = fullUrls;
                imageUrl.value = fullUrls[0]; // 第一张作为主图
                
                // 更新节点数据，供下游节点使用
                props.data.imageUrl = res.data.image_url || allImages[0];
                props.data.imageUrls = allImages;
                
                console.log(`👉 成功生成 ${fullUrls.length} 张图片:`, fullUrls);
                ElMessage.success(`成功生成 ${fullUrls.length} 张图片！`);
                
                // 标记节点为已执行
                isExecuted.value = true;
                
                // 🔥 为每张图片创建新的 ImageNode 节点
                if (fullUrls.length > 0 && currentNode.value) {
                    createImageNodes(fullUrls, allImages);
                }
            } else if (res.data.image_url) {
                // 兼容旧格式：只有 image_url
                const url = res.data.image_url.startsWith('http')
                    ? res.data.image_url
                    : `${window.location.origin}${res.data.image_url}`;
                imageUrl.value = url;
                imageUrls.value = [url];
                props.data.imageUrl = res.data.image_url;
                console.log('👉 完整图片URL:', url);
                ElMessage.success('图片生成成功！');
                
                // 标记节点为已执行
                isExecuted.value = true;
                
                // 🔥 为单张图片也创建新的 ImageNode 节点
                if (currentNode.value) {
                    createImageNodes([url], [res.data.image_url]);
                }
            } else {
                console.warn('后端返回数据:', res.data);
                ElMessage.warning('生成成功，但未获取到图片URL');
            }
        } else {
            console.warn('后端返回格式异常:', res);
            ElMessage.warning('生成成功，但未获取到图片URL');
        }
    } catch (error) {
        console.error(error);
    } finally {
        loading.value = false;
    }
};


// 为每张生成的图片创建新的 ImageNode 节点
const createImageNodes = (fullUrls: string[], originalUrls: string[]) => {
    if (!currentNode.value) {
        console.warn('无法获取当前节点信息，跳过创建图片节点');
        return;
    }

    const nodeWidth = currentNode.value.dimensions?.width || 480;
    const startX = currentNode.value.position.x + nodeWidth + 80;
    const startY = currentNode.value.position.y;
    
    // 根据图片数量动态调整节点尺寸和间距
    const isMultipleImages = fullUrls.length > 1;
    const nodeSpacing = isMultipleImages ? 180 : 280; // 多图时缩小间距
    const nodeWidthForImage = isMultipleImages ? 180 : 240; // 多图时缩小节点宽度

    fullUrls.forEach((fullUrl, index) => {
        const nodeId = `image_node_${Date.now()}_${index}`;
        const edgeId = `edge_${Date.now()}_${index}`;

        // 计算新节点位置（垂直排列）
        const newNodePosition = {
            x: startX,
            y: startY + index * nodeSpacing
        };
        
        // 为多图节点添加标记，用于缩小尺寸
        const nodeData: any = {
            imageUrl: fullUrl,
            prompt: prompt.value || props.data?.prompt || '',
            originalImageUrl: originalUrls[index]
        };
        
        if (isMultipleImages) {
            nodeData.isCompact = true; // 标记为紧凑模式
        }

        // 创建图片节点
        addNodes({
            id: nodeId,
            type: 'image',
            position: newNodePosition,
            data: nodeData
        });

        // 创建从当前节点到图片节点的连接
        addEdges({
            id: edgeId,
            source: props.id,
            target: nodeId,
            sourceHandle: 'source',
            targetHandle: 'target'
        });
    });

    console.log(`✅ 已为 ${fullUrls.length} 张图片创建独立节点`);
};
</script>

<style scoped>
.dream-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 420px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
}

/* 节点标题已移除，保留样式以防其他地方使用 */

.node-content {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid #eee;
}

.input-section,
.params-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
}

.arrow-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: #f5f5f5;
    border-radius: 2px;
    color: #666;
    font-size: 12px;
    font-weight: normal;
}

/* 提示词输入区域 */
.prompt-wrapper {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
}

.prompt-content {
    position: relative;
    background: #f8f9fa;
}

.prompt-input {
    width: 100%;
}

.prompt-input :deep(.el-textarea__inner) {
    min-height: 180px !important;
    line-height: 1.6;
    padding: 8px 12px;
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

.prompt-input :deep(.el-textarea__inner)::placeholder {
    color: #999;
}

.prompt-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
}

.save-prompt-btn,
.polish-btn {
    font-size: 12px;
    padding: 4px 12px;
    height: auto;
}

/* 提示词建议列表 */
.prompt-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 4px;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background-color 0.2s;
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

/* 上传区域 */
.upload-content {
    background: #f8f9fa;
}

.image-thumbnails {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
}

.image-thumbnails::after {
    content: '';
    flex: 1 1 calc(33.333% - 8px);
    max-width: calc(33.333% - 8px);
}

.thumbnail-item {
    position: relative;
    width: calc(33.333% - 6px);
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    transition: transform 0.2s;
    flex: 0 0 calc(33.333% - 6px);
}

.thumbnail-item:hover {
    transform: scale(1.05);
}

.thumbnail-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.remove-thumb-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 10;
    width: 18px;
    height: 18px;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
}

.remove-thumb-btn:hover {
    background: rgba(255, 0, 0, 0.7);
}

.upload-demo {
    width: 100%;
}

.upload-demo :deep(.el-upload) {
    width: 100%;
}

.upload-btn {
    width: 100%;
    border-style: dashed;
    border-color: #d0d0d0;
    color: #666;
}

.upload-btn:hover {
    border-color: #409eff;
    color: #409eff;
}

/* 参数设置区域 */
.params-section {
    border-left: 1px solid #eee;
    padding-left: 12px;
}

.param-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.param-label {
    font-size: 12px;
    color: #909399;
    margin-bottom: 4px;
}

.param-select {
    width: 100%;
    margin-bottom: 6px;
}

.model-select {
    max-width: 100%;
}

.param-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #909399;
    margin-top: 4px;
    padding: 4px 8px;
    background: #f5f7fa;
    border-radius: 4px;
}

.param-hint .el-icon {
    font-size: 12px;
    color: #409eff;
}

.execute-btn {
    width: 100%;
    margin-top: 8px;
}

.executed-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    margin-top: 8px;
    color: #67c23a;
    font-size: 13px;
    font-weight: 500;
    background: #f0f9ff;
    border-radius: 4px;
}

.executed-status .el-icon {
    font-size: 16px;
}

/* 全屏预览样式 */
.fullscreen-preview-dialog {
    margin: 0 !important;
    padding: 0 !important;
}

.fullscreen-preview-dialog :deep(.el-dialog) {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    margin: 0 !important;
    padding: 0 !important;
    background: rgba(0, 0, 0, 0.95) !important;
    border-radius: 0 !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 10000 !important;
}

.fullscreen-preview-dialog :deep(.el-dialog__header) {
    padding: 0 !important;
    margin: 0 !important;
    height: 0 !important;
    overflow: hidden;
}

.fullscreen-preview-dialog :deep(.el-dialog__body) {
    padding: 0 !important;
    margin: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
}

.fullscreen-preview-dialog :deep(.el-overlay) {
    background-color: rgba(0, 0, 0, 0.95) !important;
    z-index: 9999 !important;
}

.preview-header {
    display: none;
}

.fullscreen-preview-container {
    width: 100vw !important;
    height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer;
    position: relative;
}

.fullscreen-image {
    max-width: 95vw !important;
    max-height: 95vh !important;
    object-fit: contain !important;
    cursor: zoom-out;
    user-select: none;
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

.centered-save-prompt-dialog :deep(.el-dialog__header) {
    padding: 24px 30px !important;
    margin: 0 !important;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
}

.centered-save-prompt-dialog :deep(.el-dialog__title) {
    font-size: 20px !important;
    font-weight: 600 !important;
    color: #303133;
}

.centered-save-prompt-dialog :deep(.el-dialog__body) {
    padding: 30px !important;
    overflow-y: auto !important;
    flex: 1 !important;
    min-height: 0 !important;
}

.centered-save-prompt-dialog :deep(.el-dialog__footer) {
    padding: 20px 30px !important;
    border-top: 1px solid #e0e0e0;
    flex-shrink: 0;
}

</style>