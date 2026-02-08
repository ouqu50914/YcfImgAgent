<template>
    <div class="layer-separation-node">
        <!-- 顶部标题 -->
        <div class="node-header">
            <el-icon>
                <Grid />
            </el-icon>
            <span>图层分离</span>
        </div>

        <!-- 内容区域 -->
        <div class="node-content">
            <!-- 参数设置，样式对齐生图节点 -->
            <div class="params-section">
                <!-- 模型选择（与生图节点一致） -->
                <div class="param-item">
                    <div class="param-label">模型</div>
                    <el-select v-model="selectedModel" placeholder="选择模型" size="small" class="param-select model-select">
                        <el-option label="Qwen-Image-Layered" value="qwen" />
                        <el-option label="Seedream" value="dream" />
                    </el-select>
                </div>

                <!-- 分离类型 -->
                <div class="param-item">
                    <div class="param-label">分离类型</div>
                    <el-select v-model="separationType" placeholder="选择分离类型" size="small" class="param-select">
                        <el-option label="自动分离" value="auto" />
                        <el-option label="人物分离" value="person" />
                        <el-option label="物体分离" value="object" />
                        <el-option label="背景分离" value="background" />
                    </el-select>
                </div>

                <!-- 分离提示词 -->
                <div class="param-item">
                    <div class="param-label">分离提示词</div>
                    <el-input v-model="prompt" type="textarea" :rows="2" placeholder="输入分离提示词（可选）" size="small" class="param-input" />
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
                @click="handleSeparate"
            >
                {{ executeButtonText }}
            </el-button>
            
            <!-- 已执行状态 -->
            <div v-else class="executed-status">
                <el-icon><CircleCheck /></el-icon>
                <span>已执行</span>
                <span class="layer-count">共{{ layers.length }}层</span>
            </div>
        </div>

        <!-- 图层预览 -->
        <div v-if="layers.length > 0" class="layers-preview">
            <div class="preview-title">分离结果</div>
            <div class="layers-grid">
                <div 
                    v-for="(layer, index) in layers" 
                    :key="index"
                    class="layer-item"
                    @click="previewLayer(layer.url)"
                >
                    <img :src="layer.url" class="layer-thumbnail" :alt="layer.name" />
                    <div class="layer-name">{{ layer.name }}</div>
                </div>
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
import { ref, watch, computed } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Grid, CircleCheck } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import request from '@/utils/request';
import { useUserStore } from '@/store/user';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();

const { findNode, getEdges, addNodes, addEdges, getNodes } = useVueFlow();
const userStore = useUserStore();

// 图层分离使用 Dream API，固定 1 积分
const executeCost = 1;
const canExecute = computed(() => {
    if (userStore.userInfo?.role === 1) return true;
    return (userStore.userInfo?.credits ?? 0) >= executeCost;
});
const executeButtonText = computed(() => {
    if (loading.value) return '分离中...';
    if (userStore.userInfo?.role === 1) return '开始分离';
    return `开始分离 (消耗 ${executeCost} 积分)`;
});

const inputImageUrl = ref(props.data?.imageUrl || '');
const selectedModel = ref<string>('qwen');
const separationType = ref('auto');
const prompt = ref('');
const loading = ref(false);
const isExecuted = ref(false);
const layers = ref<any[]>([]);
const showFullscreenPreview = ref(false);
const previewImageUrl = ref('');

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});

// 获取完整图片URL
const getImageUrl = (url: string) => {
    if (!url) return '';
    if (typeof url !== 'string') return '';
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

const handleSeparate = async () => {
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
        // 调用图层分离API
        const res: any = await request.post('/api/layer/split', {
            imageUrl: finalImageUrl
        });

        if (res.data && res.data.layers) {
            // 处理分离结果
            layers.value = res.data.layers.map((layer: any) => {
                return {
                    ...layer,
                    url: layer.url.startsWith('http')
                        ? layer.url
                        : `${window.location.origin}${layer.url}`
                };
            });
            
            ElMessage.success(`成功分离出 ${layers.value.length} 个图层！`);
            userStore.fetchCredits();
            
            // 标记节点为已执行
            isExecuted.value = true;
            
            // 为每个图层创建下游图片节点
            await createLayerNodes();
        } else {
            ElMessage.warning('分离成功，但未获取到图层数据');
        }
    } catch (error: any) {
        console.error('图层分离失败:', error);
        ElMessage.error(error.response?.data?.message || error.message || '图层分离失败');
    } finally {
        loading.value = false;
    }
};

// 为分离后的每个图层创建下游图片节点
const createLayerNodes = async () => {
    if (!currentNode.value || layers.value.length === 0) {
        return;
    }

    const nodeWidth = currentNode.value.dimensions?.width || 280;
    const startX = currentNode.value.position.x + nodeWidth + 100;
    const startY = currentNode.value.position.y;
    const verticalSpacing = 200; // 图层节点垂直间距

    for (let i = 0; i < layers.value.length; i++) {
        const layer = layers.value[i];
        const nodeId = `layer_node_${Date.now()}_${i}`;
        const edgeId = `edge_layer_${Date.now()}_${i}`;

        // 创建图片节点
        addNodes({
            id: nodeId,
            type: 'image',
            position: {
                x: startX,
                y: startY + i * verticalSpacing
            },
            data: {
                imageUrl: layer.url,
                name: layer.name,
                prompt: prompt.value || '图层分离',
                originalImageUrl: layer.url.includes('/uploads/') ? layer.url : ''
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
    }

    console.log(`✅ 已为分离后的 ${layers.value.length} 个图层创建独立节点`);
};

// 预览图层
const previewLayer = (url: string) => {
    previewImageUrl.value = url;
    showFullscreenPreview.value = true;
};
</script>

<style scoped>
.layer-separation-node {
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
    border-bottom: 1px solid #404040;
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

.param-input {
    width: 132px;
    margin-bottom: 0;
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

.layer-count {
    font-size: 12px;
    color: #909399;
    margin-left: 4px;
}

.layers-preview {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #eee;
}

.preview-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 8px;
}

.layers-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
}

.layer-item {
    position: relative;
    cursor: pointer;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s;
}

.layer-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.layer-thumbnail {
    width: 100%;
    height: 60px;
    object-fit: cover;
}

.layer-name {
    font-size: 11px;
    color: #606266;
    padding: 4px 6px;
    background: #f5f7fa;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
.layer-separation-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.layer-separation-node:hover :deep(.vue-flow__handle) {
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