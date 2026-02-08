<template>
    <div 
        :class="['image-node', { 'image-node-compact': props.data?.isCompact }]"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
    >

        <!-- 图片展示区域（类似参考图样式） -->
        <div 
            class="image-content" 
            @mouseenter="handleImageMouseEnter"
            @mouseleave="handleImageMouseLeave"
        >
            <div class="section-title"><span class="title-dot"></span>图片</div>
            <!-- 加载中占位 -->
            <div v-if="isLoading" class="image-slot loading-slot"></div>
            <!-- 实际图片 -->
            <el-image 
                v-else
                :src="imageUrl" 
                fit="contain" 
                class="img-preview"
                :preview-src-list="[]"
                :hide-on-click-modal="false"
                lazy
                :loading="'lazy'"
                @click="handleImageClick"
            >
                <template #error>
                    <div class="image-slot">加载失败</div>
                </template>
            </el-image>

            <!-- 功能菜单（鼠标悬停显示） -->
            <transition name="fade">
                <div
                    v-if="showActionMenu"
                    class="action-menu"
                    @mouseenter="handleMenuMouseEnter"
                    @mouseleave="handleMenuMouseLeave"
                >
                    <el-tooltip content="下载原图" placement="top" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="primary"
                            circle
                            @click="handleDownloadOriginal"
                        >
                            <el-icon><Download /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="放大" placement="top" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="primary"
                            circle
                            @click="handleAddActionNode('upscale')"
                        >
                            <el-icon><ZoomIn /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="扩展" placement="top" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="success"
                            circle
                            @click="handleAddActionNode('extend')"
                        >
                            <el-icon><FullScreen /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="生成变体" placement="top" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="info"
                            circle
                            @click="handleAddActionNode('variation')"
                        >
                            <el-icon><CopyDocument /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="图层拆分" placement="top" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="danger"
                            circle
                            :loading="creatingLayerNode"
                            @click="handleSplitLayer"
                        >
                            <el-icon v-if="!creatingLayerNode"><Grid /></el-icon>
                        </el-button>
                    </el-tooltip>
                </div>
            </transition>
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
            <template #header>
                <div class="preview-header">
                    <span>图片预览</span>
                    <el-button
                        text
                        type="primary"
                        @click="showFullscreenPreview = false"
                        style="position: absolute; right: 20px; top: 20px; z-index: 10001;"
                    >
                        <el-icon><Close /></el-icon>
                    </el-button>
                </div>
            </template>
            <div class="fullscreen-preview-container" @click="showFullscreenPreview = false">
                <img 
                    :src="getImageUrl(imageUrl)" 
                    class="fullscreen-image"
                    @click.stop
                />
            </div>
        </el-dialog>

        <!-- 节点连接点 -->
        <Handle 
            id="target" 
            type="target" 
            class="handle-target"
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
            id="image-source" 
            type="source" 
            class="handle-source"
            :position="Position.Right" 
            :style="{ 
                background: '#67c23a', 
                width: '12px', 
                height: '12px', 
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { ZoomIn, FullScreen, Refresh, CopyDocument, Grid, Close, Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();

const { findNode, getEdges, addNodes, addEdges, getNodes } = useVueFlow();

const imageUrl = ref(props.data?.imageUrl || '');
const isLoading = ref(!!props.data?.isLoading);
const showActionMenu = ref(false);
const creatingLayerNode = ref(false);
const showFullscreenPreview = ref(false);

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});

// 响应外部数据更新（例如占位节点生成后再写入 imageUrl）
watch(
    () => props.data?.imageUrl,
    (val) => {
        if (val) {
            imageUrl.value = val;
        }
    }
);

watch(
    () => props.data?.isLoading,
    (val) => {
        isLoading.value = !!val;
    }
);

// 确保从来源生图节点到当前图片节点有一条连线（防止外部逻辑覆盖了 edges）
const ensureEdgeFromSource = () => {
    const fromNodeId = props.data?.fromNodeId as string | undefined;
    if (!fromNodeId) return;

    const edges = getEdges.value;
    const exists = edges.some(
        (edge) =>
            edge.source === fromNodeId &&
            edge.target === props.id
    );

    if (!exists) {
        addEdges({
            id: `edge-auto-${fromNodeId}-${props.id}-${Date.now()}`,
            source: fromNodeId,
            target: props.id,
            sourceHandle: 'source',
            targetHandle: 'target',
        });
    }
};

onMounted(() => {
    ensureEdgeFromSource();
});

let menuTimeout: ReturnType<typeof setTimeout> | null = null;

// 鼠标进入节点
const handleMouseEnter = () => {
    // 节点级别的鼠标进入不做处理，由图片区域处理
};

// 鼠标离开节点
const handleMouseLeave = () => {
    // 延迟检查，避免快速移动时菜单闪烁
    if (menuTimeout) clearTimeout(menuTimeout);
    menuTimeout = setTimeout(() => {
        showActionMenu.value = false;
    }, 200);
};

// 鼠标进入图片区域
const handleImageMouseEnter = () => {
    if (imageUrl.value) {
        if (menuTimeout) clearTimeout(menuTimeout);
        showActionMenu.value = true;
        console.log('鼠标进入图片区域，显示菜单');
    }
};

// 鼠标离开图片区域
const handleImageMouseLeave = () => {
    // 延迟隐藏，给菜单留出时间
    if (menuTimeout) clearTimeout(menuTimeout);
    menuTimeout = setTimeout(() => {
        showActionMenu.value = false;
    }, 200);
};

// 鼠标进入菜单
const handleMenuMouseEnter = () => {
    if (menuTimeout) clearTimeout(menuTimeout);
    showActionMenu.value = true;
};

// 鼠标离开菜单
const handleMenuMouseLeave = () => {
    if (menuTimeout) clearTimeout(menuTimeout);
    menuTimeout = setTimeout(() => {
        showActionMenu.value = false;
    }, 100);
};

// 添加操作节点
const handleAddActionNode = (actionType: 'upscale' | 'extend' | 'variation') => {
    if (!imageUrl.value) {
        ElMessage.warning('图片不存在');
        return;
    }

    if (!currentNode.value) {
        ElMessage.error('无法获取当前节点信息');
        return;
    }

    const nodeId = `node_${Date.now()}`;
    const edgeId = `edge_${Date.now()}`;

    // 计算新节点位置（当前节点右侧 + 偏移量）
    const nodeWidth = currentNode.value.dimensions?.width || 240;
    const newNodePosition = {
        x: currentNode.value.position.x + nodeWidth + 100,
        y: currentNode.value.position.y
    };

    // 根据操作类型创建不同的节点
    let nodeType = '';
    let nodeData: any = { imageUrl: imageUrl.value };

    switch (actionType) {
        case 'upscale':
            nodeType = 'upscale';
            break;
        case 'extend':
            nodeType = 'extend';
            break;
        case 'variation':
            // 生成变体使用 dream 节点
            nodeType = 'dream';
            nodeData = {
                imageUrl: imageUrl.value,
                prompt: props.data?.prompt || '',
                isVariation: true
            };
            break;
    }

    // 添加新节点
    addNodes({
        id: nodeId,
        type: nodeType,
        position: newNodePosition,
        data: nodeData
    });

    // 创建连接
    addEdges({
        id: edgeId,
        source: props.id,
        target: nodeId
    });

    showActionMenu.value = false;
    ElMessage.success(`已添加${actionType === 'upscale' ? '放大' : actionType === 'extend' ? '扩展' : '变体'}节点`);
};

// 图层拆分：创建独立的 LayerNode 节点承接结果
const handleSplitLayer = async () => {
    if (!imageUrl.value) {
        ElMessage.warning('图片不存在');
        return;
    }

    if (!currentNode.value) {
        ElMessage.error('无法获取当前节点信息');
        return;
    }

    creatingLayerNode.value = true;
    showActionMenu.value = false;

    try {
        const nodeId = `layer_node_${Date.now()}`;
        const edgeId = `edge_${Date.now()}`;

        const nodeWidth = currentNode.value.dimensions?.width || 240;
        const newNodePosition = {
            x: currentNode.value.position.x + nodeWidth + 100,
            y: currentNode.value.position.y
        };

        addNodes({
            id: nodeId,
            type: 'layer',
            position: newNodePosition,
            data: {
                imageUrl: imageUrl.value,
                fromNodeId: props.id
            }
        });

        addEdges({
            id: edgeId,
            source: props.id,
            target: nodeId,
            sourceHandle: 'image-source',
            targetHandle: 'target'
        });

        ElMessage.success('已添加图层拆分结果节点');
    } catch (error: any) {
        ElMessage.error(error.message || '创建图层拆分节点失败');
    } finally {
        creatingLayerNode.value = false;
    }
};

// 获取完整图片URL
const getImageUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('/uploads/')) {
        return `${window.location.origin}${url}`;
    }
    return url;
};

// 点击图片预览
const handleImageClick = () => {
    if (imageUrl.value) {
        showFullscreenPreview.value = true;
    }
};

// 下载原图
const handleDownloadOriginal = () => {
    const original = (props.data as any)?.originalImageUrl || imageUrl.value;
    if (!original) {
        ElMessage.warning('暂无可下载的原图');
        return;
    }

    const fullUrl = getImageUrl(original);
    const link = document.createElement('a');
    link.href = fullUrl;
    link.download = 'image.png';
    link.click();
};
</script>

<style scoped>
.image-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 240px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
    transition: all 0.2s;
}

/* 默认隐藏所有 handle，hover 时显示（更接近参考图交互） */
.image-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.image-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

/* 图片节点不可被链接：永久隐藏左侧 target handle */
.image-node :deep(.vue-flow__handle.handle-target) {
    opacity: 0 !important;
    pointer-events: none !important;
}

.image-node-compact {
    width: 180px;
}

/* 节点标题已移除，保留样式以防其他地方使用 */

.section-title {
    font-size: 13px;
    color: #e0e0e0;
    margin-bottom: 8px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
}

.section-title .title-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #67c23a;
    flex-shrink: 0;
}

.image-content {
    padding: 14px 16px;
    position: relative;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: all 0.2s;
}

.image-content:hover {
    background: transparent;
}

.img-preview {
    width: 100%;
    display: block;
    border-radius: 8px;
    border: 1px solid #404040;
    object-fit: contain;
    transition: transform 0.2s, box-shadow 0.2s;
}

.image-content:hover .img-preview {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.action-menu {
    position: absolute;
    top: 6px;              /* 与标题行垂直对齐 */
    right: 12px;           /* 与图片右侧边缘更贴齐 */
    transform: none;
    display: flex;
    flex-direction: row;   /* 横向排列按钮 */
    gap: 6px;
    align-items: center;
    background: transparent;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    z-index: 99999;
    pointer-events: auto;
    visibility: visible;
    opacity: 1;
}

.action-icon-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin: 0;
}

.action-icon-btn :deep(.el-icon) {
    font-size: 11px;
    line-height: 1;
}

.action-menu :deep(.el-tooltip) {
    display: flex;
    justify-content: center;
}

.action-menu :deep(.el-button) {
    border: none;
    box-shadow: none;
    background-color: rgba(0, 0, 0, 0.55);
}

.action-menu :deep(.el-button:hover),
.action-menu :deep(.el-button:focus),
.action-menu :deep(.el-button:active) {
    border: none;
    box-shadow: none;
    background-color: rgba(0, 0, 0, 0.75);
}

.image-slot {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 150px;
    background: #25262b;
    border-radius: 8px;
    border: 1px solid #404040;
}

.loading-slot {
    background: linear-gradient(90deg, #25262b 0%, #2d2e34 50%, #25262b 100%);
    background-size: 200% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
    border-radius: 8px;
    border: 1px solid #404040;
}

@keyframes shimmer {
    0% {
        background-position: 200% 0;
    }
    100% {
        background-position: -200% 0;
    }
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.layer-result {
    padding: 20px 0;
}

.layer-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-top: 16px;
}

.layer-item {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.layer-image {
    width: 100%;
    height: 150px;
    border-radius: 4px;
    border: 1px solid #eee;
}

.layer-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.layer-name {
    font-weight: 600;
    font-size: 14px;
    color: #333;
}

.layer-type {
    font-size: 12px;
    color: #999;
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
    max-width: 100vw !important;
    max-height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer;
    position: relative;
    overflow: hidden !important;
}

.fullscreen-image {
    max-width: 95vw !important;
    max-height: 95vh !important;
    object-fit: contain !important;
    cursor: zoom-out;
    user-select: none;
}
</style>
