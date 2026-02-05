<template>
    <div 
        v-if="visible"
        class="connection-menu"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
        @click.stop
    >
        <div 
            class="menu-item"
            @click="handleGenerateImage"
        >
            <el-icon><Picture /></el-icon>
            <span>生成图片</span>
        </div>
        <div 
            class="menu-item"
            @click="handleGenerateVideo"
        >
            <el-icon><VideoCamera /></el-icon>
            <span>生成视频</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Picture, VideoCamera } from '@element-plus/icons-vue';

interface Position {
    x: number;
    y: number;
}

const props = defineProps<{
    visible: boolean;
    position: Position;
}>();

const emit = defineEmits<{
    generateImage: [];
    generateVideo: [];
    close: [];
}>();

const handleGenerateImage = () => {
    emit('generateImage');
    emit('close');
};

const handleGenerateVideo = () => {
    emit('generateVideo');
    emit('close');
};

// 点击外部关闭菜单：
// - 用 mousedown 替代 click，避免拖拽松手触发 click 导致“打开即关闭”
// - 打开后延迟一拍才开始监听，避免同一次交互直接关闭
let listening = false;

const handlePointerDownOutside = (event: MouseEvent) => {
    if (!props.visible) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.connection-menu')) emit('close');
};

watch(
    () => props.visible,
    async (v) => {
        if (!v) return;
        listening = false;
        await nextTick();
        setTimeout(() => (listening = true), 0);
    }
);

const guardedHandler = (event: MouseEvent) => {
    if (!listening) return;
    handlePointerDownOutside(event);
};

onMounted(() => {
    document.addEventListener('mousedown', guardedHandler);
});

onUnmounted(() => {
    document.removeEventListener('mousedown', guardedHandler);
});
</script>

<style scoped>
.connection-menu {
    position: fixed;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    min-width: 150px;
    padding: 4px 0;
    font-size: 14px;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.menu-item:hover {
    background-color: #f5f7fa;
}

.menu-item .el-icon {
    font-size: 16px;
    color: #606266;
}

.menu-item span {
    color: #303133;
}
</style>
