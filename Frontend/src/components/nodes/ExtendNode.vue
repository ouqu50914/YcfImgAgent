<template>
    <div class="extend-node">
        <!-- 顶部标题 -->
        <div class="node-header">
            <el-icon>
                <FullScreen />
            </el-icon>
            <span>图片扩展</span>
        </div>

        <!-- 内容区域 -->
        <div class="node-content">
            <div class="params-section">
                <!-- 模型选择（与生图节点一致） -->
                <div class="param-item">
                    <div class="param-label">模型</div>
                    <el-select v-model="selectedModel" placeholder="选择模型" size="small" class="param-select model-select">
                        <el-option label="Seedream" value="dream" />
                        <el-option label="Nano Banana 2" value="nano:nano-banana-2" />
                        <el-option label="Nano Banana Pro" value="nano:nano-banana-pro" />
                    </el-select>
                </div>

                <!-- 扩展方向选择 -->
                <div class="param-item">
                    <div class="param-label">扩展方向</div>
                    <el-select v-model="direction" placeholder="选择扩展方向" size="small" class="param-select">
                        <el-option label="向上 (Top)" value="top" />
                        <el-option label="向下 (Bottom)" value="bottom" />
                        <el-option label="向左 (Left)" value="left" />
                        <el-option label="向右 (Right)" value="right" />
                        <el-option label="全周 (All Around)" value="all" />
                    </el-select>
                </div>

                <!-- 比例选择 -->
                <div class="param-item">
                    <div class="param-label">图片比例</div>
                    <el-select v-model="ratio" placeholder="选择比例" size="small" class="param-select">
                        <el-option label="自动 (Auto)" value="auto" />
                        <el-option label="1:1" value="1:1" />
                        <el-option label="4:3" value="4:3" />
                        <el-option label="3:4" value="3:4" />
                        <el-option label="16:9" value="16:9" />
                        <el-option label="9:16" value="9:16" />
                        <el-option label="3:2" value="3:2" />
                        <el-option label="2:3" value="2:3" />
                        <el-option label="21:9" value="21:9" />
                    </el-select>
                </div>

                <!-- 扩展提示词（可选） -->
                <div class="param-item" style="align-items: flex-start;">
                    <div class="param-label">扩展提示词</div>
                    <el-input
                        v-model="extendPrompt"
                        type="textarea"
                        :rows="2"
                        placeholder="扩展区域提示词（可选，可通过提示词控制比例）..."
                        class="param-select"
                        size="small"
                    />
                </div>
            </div>

            <!-- 生成按钮 -->
            <el-button
                v-if="!isExecuted"
                type="primary"
                size="small"
                class="w-100 execute-btn"
                :loading="loading"
                :disabled="!canExecute"
                @click="handleExtend"
            >
                {{ executeButtonText }}
            </el-button>
            
            <!-- 已执行状态 -->
            <div v-else class="executed-status">
                <el-icon><CircleCheck /></el-icon>
                <span>已执行</span>
            </div>
        </div>

        <!-- 节点连接点 -->
        <Handle 
            id="target" 
            type="target" 
            :position="Position.Left" 
            :style="{ 
                background: '#409eff', 
                width: '12px', 
                height: '12px', 
                border: '2px solid #1a1a1a',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
        <Handle 
            id="source" 
            type="source" 
            :position="Position.Right" 
            :style="{ 
                background: '#409eff', 
                width: '12px', 
                height: '12px', 
                border: '2px solid #1a1a1a',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
    </div>

    <!-- 全屏预览对话框 -->
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
</template>

<script setup lang="ts">
import { ref, watch, computed, inject } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { FullScreen, CircleCheck } from '@element-plus/icons-vue';
import { extendImage } from '../../api/image';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import { getCreditCost } from '@/utils/credits';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

type ImageAliasStore = {
    getOrCreateAlias: (imageKey: string) => string;
    getAllAliases: () => { key: string; alias: string }[];
};

const props = defineProps<NodeProps>();

const { findNode, getEdges, addNodes, addEdges, getNodes } = useVueFlow();
const imageAliasStore = inject<ImageAliasStore | null>('imageAliasStore', null);
const userStore = useUserStore();

const inputImageUrl = ref(props.data?.imageUrl || '');
const direction = ref<'top' | 'bottom' | 'left' | 'right' | 'all'>('right');
const ratio = ref<string>('auto');
const extendPrompt = ref('');
const selectedModel = ref<string>('dream');
const apiType = computed<'dream' | 'nano'>(() => {
    return selectedModel.value.startsWith('nano:') ? 'nano' : 'dream';
});
const nanoModel = computed<string | undefined>(() => {
    if (!selectedModel.value.startsWith('nano:')) return undefined;
    return selectedModel.value.split(':')[1];
});

const executeCost = computed(() => getCreditCost(apiType.value, 'extend'));
const canExecute = computed(() => {
    if (userStore.userInfo?.role === 1) return true;
    return (userStore.userInfo?.credits ?? 0) >= executeCost.value;
});
const executeButtonText = computed(() => {
    if (loading.value) return '扩展中...';
    if (userStore.userInfo?.role === 1) return '开始扩展';
    return `开始扩展 (消耗 ${executeCost.value} 积分)`;
});

const loading = ref(false);
const isExecuted = ref(false);
const showFullscreenPreview = ref(false);
const previewImageUrl = ref('');

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});

// 获取完整图片URL
const getImageUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('/uploads/')) {
        return `${window.location.origin}${url}`;
    }
    return url;
};

// 监听上游节点连接
watch(
    () => getEdges.value,
    (edges) => {
        const targetEdge = edges.find((e) => e.target === props.id);
        if (targetEdge) {
            const sourceNode = findNode(targetEdge.source);
            if (sourceNode) {
                // 尝试从上游节点获取图片URL
                if (sourceNode.data?.imageUrl) {
                    inputImageUrl.value = sourceNode.data.imageUrl;
                    props.data.imageUrl = sourceNode.data.imageUrl;
                } else if (sourceNode.data?.image_url) {
                    inputImageUrl.value = sourceNode.data.image_url;
                    props.data.imageUrl = sourceNode.data.image_url;
                } else if (sourceNode.data?.imageUrls && sourceNode.data.imageUrls.length > 0) {
                    // 如果有多个图片，使用第一张
                    inputImageUrl.value = sourceNode.data.imageUrls[0];
                    props.data.imageUrl = sourceNode.data.imageUrls[0];
                }
            }
        } else {
            // 如果没有上游连接，使用手动输入的URL或节点数据中的URL
            if (!inputImageUrl.value && props.data?.imageUrl) {
                inputImageUrl.value = props.data.imageUrl;
            }
        }
    },
    { immediate: true, deep: true }
);

const handleExtend = async () => {
    if (!canExecute.value) {
        ElMessage.warning('积分不足，请向超级管理员申请');
        return;
    }
    const finalImageUrl = inputImageUrl.value;

    if (!finalImageUrl) {
        ElMessage.warning('请先从图片节点连接一张图片');
        return;
    }

    loading.value = true;
    try {
        const params: any = {
            apiType: apiType.value,
            imageUrl: finalImageUrl,
            direction: direction.value,
            ratio: ratio.value !== 'auto' ? ratio.value : undefined,
            prompt: extendPrompt.value || undefined
        };

        // Nano Banana 2 / Pro：传递具体模型给后端
        if (apiType.value === 'nano' && nanoModel.value) {
            params.model = nanoModel.value;
        }

        console.log('[前端 ExtendNode] 调用 extendImage，参数:', params);

        const res: any = await extendImage(params);

        if (res.data && res.data.image_url) {
            const url = res.data.image_url.startsWith('http')
                ? res.data.image_url
                : `${window.location.origin}${res.data.image_url}`;
            // 更新节点数据，供下游节点使用
            props.data.imageUrl = url;
            ElMessage.success('图片扩展成功！');
            userStore.fetchCredits();
            
            // 标记节点为已执行
            isExecuted.value = true;
            
            // 🔥 创建新的 ImageNode 节点显示扩展后的图片
            if (currentNode.value) {
                createImageNode(url, res.data.image_url);
            }
        } else {
            ElMessage.warning('扩展成功，但未获取到图片URL');
        }
    } catch (error: any) {
        console.error(error);
        ElMessage.error(error.message || '图片扩展失败');
    } finally {
        loading.value = false;
    }
};

// 为扩展后的图片创建新的 ImageNode 节点
const createImageNode = (fullUrl: string, originalUrl: string) => {
    if (!currentNode.value) {
        console.warn('无法获取当前节点信息，跳过创建图片节点');
        return;
    }

    const nodeWidth = currentNode.value.dimensions?.width || 280;
    const startX = currentNode.value.position.x + nodeWidth + 100;
    const startY = currentNode.value.position.y;

    const nodeId = `image_node_${Date.now()}`;
    const edgeId = `edge_${Date.now()}`;

    const imageKey: string = originalUrl || fullUrl;
    const alias = imageAliasStore?.getOrCreateAlias(imageKey) ?? '';

    // 创建图片节点
    addNodes({
        id: nodeId,
        type: 'image',
        position: {
            x: startX,
            y: startY
        },
        data: {
            imageUrl: fullUrl,
            prompt: extendPrompt.value || props.data?.prompt || '图片扩展',
            // 保存原始URL（相对路径）供后续使用
            originalImageUrl: originalUrl,
            imageAlias: alias,
            imageKey,
        }
    });

    // 创建从当前节点到图片节点的连接
    addEdges({
        id: edgeId,
        source: props.id,
        target: nodeId,
        sourceHandle: 'source',
        targetHandle: 'target'
    });

    console.log('✅ 已为扩展后的图片创建独立节点');
};
</script>

<style scoped>
.extend-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 280px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    font-family: 'Helvetica Neue', Arial, sans-serif;
}

.node-header {
    background: #3a3a3f;
    color: #e0e0e0;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    gap: 8px;
}

.node-content {
    padding: 14px 16px;
    color: #e0e0e0;
}

.params-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 4px;
}

.param-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.param-label {
    font-size: 12px;
    color: #b0b0b0;
    flex: 0 0 auto;
    min-width: 72px;
}

.param-select {
    width: 132px;
    margin-bottom: 0;
}

.param-select :deep(.el-input__wrapper) {
    background: #393c45;
    border-radius: 8px;
    box-shadow: none;
    border: 1px solid #555;
}

.param-select :deep(.el-input__wrapper:hover) {
    border-color: #409eff;
}

.param-select :deep(.el-input__wrapper.is-focus) {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.model-select {
    max-width: 100%;
}

.mb-2 {
    margin-bottom: 8px;
}

.mt-2 {
    margin-top: 8px;
}

.w-100 {
    width: 100%;
}

.execute-btn {
    margin-top: 8px;
}

.executed-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    color: #67c23a;
    font-size: 13px;
    font-weight: 500;
}

.image-slot {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    background: #f5f5f5;
    color: #999;
    font-size: 12px;
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

.thumbnail-item {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #e0e0e0;
    cursor: pointer;
    transition: transform 0.2s;
}

.thumbnail-item:hover {
    transform: scale(1.02);
}

.thumbnail-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.remove-thumb-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
    width: 20px;
    height: 20px;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
}

.remove-thumb-btn:hover {
    background: rgba(255, 0, 0, 0.7);
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

.fullscreen-preview-container {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer;
    position: relative;
    overflow: hidden !important;
}

/* 默认隐藏所有 handle，hover 时显示 */
.extend-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.extend-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

.fullscreen-image {
    max-width: 95vw !important;
    max-height: 95vh !important;
    object-fit: contain !important;
    cursor: zoom-out;
    user-select: none;
}
</style>
