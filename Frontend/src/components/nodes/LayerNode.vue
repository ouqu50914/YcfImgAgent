<template>
    <div class="layer-node">
        <div class="image-content" @click="handleCardClick">
            <div class="section-title">● 图片</div>

            <!-- 加载中占位 -->
            <div v-if="isLoading" class="image-slot loading-slot"></div>

            <!-- 结果预览图片（优先展示第一个图层，没有则展示原图） -->
            <el-image
                v-else
                :src="previewImageUrl"
                fit="cover"
                class="img-preview"
                :preview-src-list="previewList"
                :hide-on-click-modal="false"
                lazy
                :loading="'lazy'"
            >
                <template #error>
                    <div class="image-slot">加载失败</div>
                </template>
            </el-image>

            <div class="node-footer">
                <span class="node-title">图层拆分结果</span>
                <el-tag
                    v-if="layerResult"
                    size="small"
                    type="info"
                    effect="plain"
                >
                    共 {{ layerResult.layerCount }} 层
                </el-tag>
            </div>
        </div>

        <!-- 图层拆分结果对话框 -->
        <el-dialog
            v-model="showLayerDialog"
            :show-close="true"
            :close-on-click-modal="true"
            :close-on-press-escape="true"
            :append-to-body="true"
            :modal="true"
            :modal-append-to-body="true"
            width="100%"
            top="0"
            class="layer-fullscreen-dialog"
            @close="showLayerDialog = false"
        >
            <template #header>
                <div class="layer-preview-header">
                    <span>图层拆分结果</span>
                </div>
            </template>
            <div v-if="layerResult" class="layer-fullscreen-container">
                <div class="layer-fullscreen-main">
                    <div class="layer-main-image-wrapper">
                        <el-image
                            :src="previewImageUrl"
                            fit="contain"
                            class="layer-main-image"
                            :preview-src-list="previewList"
                        />
                    </div>
                    <div class="layer-list-panel">
                        <p class="layer-summary">
                            共拆分出 {{ layerResult.layerCount }} 个图层：
                        </p>
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
                </div>
            </div>
        </el-dialog>

        <!-- 连接点 -->
        <Handle
            id="target"
            type="target"
            class="handle-target"
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
            class="handle-source"
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
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { ElMessage } from 'element-plus';
import { splitLayer, type LayerSplitResult } from '@/api/layer';

const props = defineProps<NodeProps>();

const isLoading = ref(true);
const showLayerDialog = ref(false);
const layerResult = ref<LayerSplitResult | null>(null);

const imageUrl = computed(() => {
    const data: any = props.data || {};
    return data.originalImageUrl || data.imageUrl || '';
});

const previewImageUrl = computed(() => {
    if (layerResult.value && layerResult.value.layers && layerResult.value.layers.length > 0 && layerResult.value.layers[0] && layerResult.value.layers[0].url) {
        return getImageUrl(layerResult.value.layers[0].url);
    }
    return getImageUrl(imageUrl.value);
});

const previewList = computed(() => {
    if (layerResult.value && layerResult.value.layers && layerResult.value.layers.length > 0) {
        return layerResult.value.layers.map(l => getImageUrl(l?.url || ''));
    }
    return [getImageUrl(imageUrl.value)];
});

const doSplit = async () => {
    if (!imageUrl.value) {
        isLoading.value = false;
        return;
    }

    isLoading.value = true;
    try {
        const res: any = await splitLayer(imageUrl.value);
        if (res.data) {
            layerResult.value = res.data;
            ElMessage.success(`成功拆分出 ${res.data.layerCount} 个图层`);
        }
    } catch (error: any) {
        ElMessage.error(error.message || '图层拆分失败');
    } finally {
        isLoading.value = false;
    }
};

onMounted(() => {
    doSplit();
});

watch(
    () => imageUrl.value,
    (val, oldVal) => {
        if (val && val !== oldVal) {
            doSplit();
        }
    }
);

const getImageUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('/uploads/')) {
        return `${window.location.origin}${url}`;
    }
    return url;
};

const downloadLayer = (url: string, name: string) => {
    const fullUrl = getImageUrl(url);
    const link = document.createElement('a');
    link.href = fullUrl;
    link.download = `${name}.png`;
    link.click();
};

const handleCardClick = () => {
    if (layerResult.value) {
        showLayerDialog.value = true;
    }
};
</script>

<style scoped>
.layer-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
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
    background: transparent;
}

.section-title {
    font-size: 12px;
    color: #e0e0e0;
    margin-bottom: 8px;
    font-weight: 500;
}

.img-preview {
    width: 100%;
    display: block;
    border-radius: 8px;
    border: 1px solid #404040;
    object-fit: cover;
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

.node-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
}

.node-title {
    font-size: 13px;
    color: #333;
    font-weight: 500;
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

/* 全屏图层预览 */
.layer-fullscreen-dialog {
    margin: 0 !important;
    padding: 0 !important;
}

.layer-fullscreen-dialog :deep(.el-dialog) {
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

.layer-fullscreen-dialog :deep(.el-dialog__header) {
    padding: 0 !important;
    margin: 0 !important;
    height: 0 !important;
    overflow: hidden;
}

.layer-fullscreen-dialog :deep(.el-dialog__body) {
    padding: 0 !important;
    margin: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
}

.layer-fullscreen-dialog :deep(.el-overlay) {
    background-color: rgba(0, 0, 0, 0.95) !important;
    z-index: 9999 !important;
}

.layer-fullscreen-container {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    display: flex;
    align-items: stretch;
    justify-content: center;
    padding: 32px 40px;
    box-sizing: border-box;
    overflow: hidden;
}

.layer-fullscreen-main {
    width: 100%;
    max-width: 1200px;
    display: flex;
    gap: 24px;
}

.layer-main-image-wrapper {
    flex: 3;
    background: #111;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.layer-main-image {
    width: 100%;
    max-height: 100%;
    border-radius: 6px;
    border: 1px solid #333;
}

.layer-list-panel {
    flex: 2;
    background: #181818;
    border-radius: 8px;
    padding: 16px;
    color: #eee;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.layer-summary {
    margin: 0 0 12px;
    font-size: 13px;
    color: #ddd;
}

.layer-list-panel .layer-grid {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
}

.layer-list-panel .layer-item {
    background: #202020;
    border-color: #333;
}

.layer-list-panel .layer-name {
    color: #f5f5f5;
}

.layer-list-panel .layer-type {
    color: #aaa;
}
</style>

