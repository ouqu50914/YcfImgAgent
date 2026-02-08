<template>
    <div 
        v-if="visible"
        class="context-menu"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
        @click.stop
    >
        <div 
            class="menu-item"
            @click="handleInsertPrompt"
        >
            <el-icon><EditPen /></el-icon>
            <span>插入文本节点</span>
            <span class="shortcut">T</span>
        </div>
        <div 
            class="menu-item"
            @click="handleInsertImage"
        >
            <el-icon><Picture /></el-icon>
            <span>插入图片节点</span>
            <span class="shortcut">I</span>
        </div>
        <div 
            class="menu-item"
            @click="handleInsertDream"
        >
            <el-icon><VideoPlay /></el-icon>
            <span>插入生图节点</span>
            <span class="shortcut">G</span>
        </div>
        <div 
            class="menu-item"
            @click="handleInsertVideo"
        >
            <el-icon><VideoCamera /></el-icon>
            <span>插入视频节点</span>
            <span class="shortcut">V</span>
        </div>
        <div 
            class="menu-item"
            @click="handleInsertLayerSeparation"
        >
            <el-icon><Grid /></el-icon>
            <span>插入图层分离节点</span>
            <span class="shortcut">L</span>
        </div>
        <div class="menu-divider"></div>
        <div 
            class="menu-item"
            @click="handleAddGroup"
        >
            <el-icon><Folder /></el-icon>
            <span>添加组</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { EditPen, Picture, VideoPlay, VideoCamera, Folder, KnifeFork, Grid } from '@element-plus/icons-vue';

interface Position {
    x: number;
    y: number;
}

const props = defineProps<{
    visible: boolean;
    position: Position;
}>();

const emit = defineEmits<{
    insertPrompt: [];
    insertImage: [];
    insertDream: [];
    insertVideo: [];
    insertLayerSeparation: [];
    addGroup: [];
    close: [];
}>();

const handleInsertPrompt = () => {
    emit('insertPrompt');
    emit('close');
};

const handleInsertImage = () => {
    emit('insertImage');
    emit('close');
};

const handleInsertDream = () => {
    emit('insertDream');
    emit('close');
};

const handleInsertVideo = () => {
    emit('insertVideo');
    emit('close');
};

const handleInsertLayerSeparation = () => {
    emit('insertLayerSeparation');
    emit('close');
};

const handleAddGroup = () => {
    emit('addGroup');
    emit('close');
};

// 点击外部关闭菜单
const handleClickOutside = (event: MouseEvent) => {
    if (props.visible) {
        const target = event.target as HTMLElement;
        if (!target.closest('.context-menu')) {
            emit('close');
        }
    }
};

onMounted(() => {
    // 用 click/mousedown 关闭即可；不要监听 contextmenu，否则会在“右键打开”时立刻触发关闭
    document.addEventListener('mousedown', handleClickOutside);
});

onUnmounted(() => {
    document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<style scoped>
.context-menu {
    position: fixed;
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    min-width: 180px;
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

.menu-item span:not(.shortcut) {
    flex: 1;
    color: #303133;
}

.shortcut {
    font-size: 12px;
    color: #909399;
    padding: 2px 6px;
    background: #f5f7fa;
    border-radius: 3px;
}

.menu-divider {
    height: 1px;
    background: #e0e0e0;
    margin: 4px 0;
}
</style>
