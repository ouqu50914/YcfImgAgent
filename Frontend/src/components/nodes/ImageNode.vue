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
            <div class="section-title">● 图片</div>
            <el-image 
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
                <template #placeholder>
                    <div class="image-slot">加载中...</div>
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
                    <el-tooltip content="放大" placement="right" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="primary"
                            circle
                            @click="handleAddActionNode('upscale')"
                        >
                            <el-icon><ZoomIn /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="扩展" placement="right" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="success"
                            circle
                            @click="handleAddActionNode('extend')"
                        >
                            <el-icon><FullScreen /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="重新生成" placement="right" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="warning"
                            circle
                            @click="handleRegenerate"
                        >
                            <el-icon><Refresh /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="生成变体" placement="right" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="info"
                            circle
                            @click="handleAddActionNode('variation')"
                        >
                            <el-icon><CopyDocument /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="图层拆分" placement="right" :show-after="300">
                        <el-button
                            class="action-icon-btn"
                            type="danger"
                            circle
                            :loading="splitting"
                            @click="handleSplitLayer"
                        >
                            <el-icon v-if="!splitting"><Grid /></el-icon>
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

        <!-- 图层拆分结果对话框 -->
        <el-dialog
            v-model="showLayerDialog"
            title="图层拆分结果"
            width="800px"
        >
            <div v-if="layerResult" class="layer-result">
                <p>共拆分出 {{ layerResult.layerCount }} 个图层：</p>
                <div class="layer-grid">
                    <div
                        v-for="layer in layerResult.layers"
                        :key="layer.index"
                        class="layer-item"
                    >
                        <el-image
                            :src="getImageUrl(layer.url)"
                            fit="cover"
                            class="layer-image"
                            :preview-src-list="layerResult.layers.map(l => getImageUrl(l.url))"
                        />
                        <div class="layer-info">
                            <div class="layer-name">{{ layer.name }}</div>
                            <div class="layer-type">{{ layer.type }}</div>
                        </div>
                        <el-button
                            size="small"
                            @click="downloadLayer(layer.url, layer.name)"
                        >
                            下载
                        </el-button>
                    </div>
                </div>
            </div>
        </el-dialog>

        <!-- 节点连接点 -->
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
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { ZoomIn, FullScreen, Refresh, CopyDocument, Grid, Close } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { splitLayer, type LayerSplitResult } from '@/api/layer';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();

const { findNode, getEdges, addNodes, addEdges, getNodes } = useVueFlow();

const imageUrl = ref(props.data?.imageUrl || '');
const showActionMenu = ref(false);
const splitting = ref(false);
const showLayerDialog = ref(false);
const layerResult = ref<LayerSplitResult | null>(null);
const showFullscreenPreview = ref(false);

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
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

// 重新生成（需要找到上游节点重新执行）
const handleRegenerate = () => {
    // 查找连接到当前节点的上游节点
    const edges = getEdges.value;
    const targetEdge = edges.find((e) => e.target === props.id);
    
    if (targetEdge) {
        const sourceNode = findNode(targetEdge.source);
        if (sourceNode && sourceNode.data && typeof sourceNode.data.onRegenerate === 'function') {
            sourceNode.data.onRegenerate();
            ElMessage.success('已触发重新生成');
        } else {
            ElMessage.warning('无法找到上游节点进行重新生成');
        }
    } else {
        ElMessage.warning('当前节点没有上游节点，无法重新生成');
    }
    showActionMenu.value = false;
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

// 图层拆分
const handleSplitLayer = async () => {
    if (!imageUrl.value) {
        ElMessage.warning('图片不存在');
        return;
    }

    splitting.value = true;
    showActionMenu.value = false;

    try {
        const res: any = await splitLayer(imageUrl.value);
        if (res.data) {
            layerResult.value = res.data;
            showLayerDialog.value = true;
            ElMessage.success(`成功拆分出 ${res.data.layerCount} 个图层`);
        }
    } catch (error: any) {
        ElMessage.error(error.message || '图层拆分失败');
    } finally {
        splitting.value = false;
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

// 下载图层
const downloadLayer = (url: string, name: string) => {
    const fullUrl = getImageUrl(url);
    const link = document.createElement('a');
    link.href = fullUrl;
    link.download = `${name}.png`;
    link.click();
};

// 点击图片预览
const handleImageClick = () => {
    if (imageUrl.value) {
        showFullscreenPreview.value = true;
    }
};
</script>

<style scoped>
.image-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
    transition: all 0.2s;
}

.image-node-compact {
    width: 180px;
}

/* 节点标题已移除，保留样式以防其他地方使用 */

.section-title {
    font-size: 12px;
    color: #666;
    margin-bottom: 8px;
    font-weight: 500;
}

.image-content {
    padding: 12px;
    position: relative;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: all 0.2s;
}

.image-content:hover {
    background: #f8f9fa;
}

.img-preview {
    width: 100%;
    display: block;
    border-radius: 4px;
    border: 1px solid #eee;
    object-fit: contain;
    transition: transform 0.2s, box-shadow 0.2s;
}

.image-content:hover .img-preview {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.action-menu {
    position: absolute;
    top: 50%;
    left: calc(100% + 10px);
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    background: white;
    padding: 8px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 99999;
    pointer-events: auto;
    visibility: visible;
    opacity: 1;
    border: 1px solid #e0e0e0;
    animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(-50%) translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
    }
}

.action-icon-btn {
    width: 36px;
    height: 36px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin: 0;
}

.action-icon-btn :deep(.el-icon) {
    font-size: 18px;
    line-height: 1;
}

.action-menu :deep(.el-tooltip) {
    display: flex;
    justify-content: center;
}

.image-slot {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 150px;
    background: #f5f5f5;
    color: #999;
    font-size: 12px;
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
</style>
