<template>
    <div class="video-node">
        <div class="node-header">
            <el-icon><VideoCamera /></el-icon>
            <span>视频生成</span>
        </div>
        
        <div class="node-content">
            <div class="placeholder-content">
                <el-icon class="placeholder-icon"><VideoCamera /></el-icon>
                <p class="placeholder-text">视频生成功能开发中</p>
                <p class="placeholder-hint">敬请期待</p>
            </div>
        </div>
        
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
            id="source" 
            type="source" 
            class="handle-source"
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
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { VideoCamera } from '@element-plus/icons-vue';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

const props = defineProps<NodeProps>();
</script>

<style scoped>
.video-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 240px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.05);
    font-family: 'Helvetica Neue', Arial, sans-serif;
}

/* 默认隐藏所有 handle，hover 时显示 */
.video-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.video-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

/* 视频节点不可被链接：永久隐藏左侧 target handle */
.video-node :deep(.vue-flow__handle.handle-target) {
    opacity: 0 !important;
    pointer-events: none !important;
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
    padding: 24px 12px;
}

.placeholder-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
}

.placeholder-icon {
    font-size: 48px;
    color: #c0c4cc;
}

.placeholder-text {
    margin: 0;
    font-size: 14px;
    color: #909399;
    font-weight: 500;
}

.placeholder-hint {
    margin: 0;
    font-size: 12px;
    color: #c0c4cc;
}
</style>
