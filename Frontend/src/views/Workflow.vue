<template>
    <div class="workflow-container">
        <div class="toolbar">
            <h3>🎨 AI 工作流编辑器</h3>
            <el-button type="primary" size="small" @click="addNode">添加生图节点</el-button>
            <el-button type="primary" size="small" @click="addPromptNode">添加提示词节点</el-button>
        </div>

        <div class="canvas-wrapper">
            <VueFlow v-model="elements" :node-types="nodeTypes" fit-view-on-init>
                <Background pattern-color="#aaa" :gap="8" />
                <Controls />
                <MiniMap />
            </VueFlow>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, markRaw } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';

// 引入默认样式
import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

// 引入自定义节点
import DreamNode from '@/components/nodes/DreamNode.vue';
import PromptNode from '@/components/nodes/PromptNode.vue';

// 注册节点类型
const nodeTypes = {
    dream: markRaw(DreamNode),
    prompt: markRaw(PromptNode),
};

// 初始节点数据
const elements = ref([
    {
        id: '1',
        type: 'dream', // 对应 nodeTypes key
        position: { x: 250, y: 100 },
        data: { label: '初始节点' },
    },
]);

// 添加按钮逻辑
const addPromptNode = () => {
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'prompt', // 类型
        position: { x: 50 + Math.random() * 100, y: 100 },
        data: { text: '一只赛博朋克的猫，霓虹灯背景' }, // 默认值
    });
};

const { addNodes } = useVueFlow();

// 添加新节点逻辑
const addNode = () => {
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'dream',
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label: `节点 ${id}` },
    });
};
</script>

<style scoped>
.workflow-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

.toolbar {
    height: 50px;
    background: #fff;
    border-bottom: 1px solid #ddd;
    display: flex;
    align-items: center;
    padding: 0 20px;
    justify-content: space-between;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    z-index: 10;
}

.canvas-wrapper {
    flex: 1;
    background: #f5f5f5;
}
</style>