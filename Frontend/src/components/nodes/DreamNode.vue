<template>
    <div class="dream-node">
        <!-- 顶部标题 -->
        <div class="node-header">
            <el-icon>
                <Picture />
            </el-icon>
            <span>即梦AI生图</span>
        </div>

        <!-- 内容区域 -->
        <div class="node-content">
            <!-- 提示词输入 -->
            <el-input v-model="prompt" type="textarea" :rows="3" placeholder="请输入画面描述..." class="mb-2" />

            <!-- 分辨率选择 -->
            <el-select v-model="size" placeholder="选择尺寸" class="mb-2" size="small">
                <el-option label="1024x1024 (1:1)" value="1024x1024" />
                <el-option label="768x1024 (3:4)" value="768x1024" />
                <el-option label="1024x768 (4:3)" value="1024x768" />
            </el-select>

            <!-- 生成按钮 -->
            <el-button type="primary" size="small" class="w-100" :loading="loading" @click="handleGenerate">
                {{ loading ? '生成中...' : '开始生成' }}
            </el-button>

            <!-- 结果展示 -->
            <div v-if="imageUrl" class="result-image mt-2">
                <el-image :src="imageUrl" :preview-src-list="[imageUrl]" fit="cover" class="img-preview">
                    <template #error>
                        <div class="image-slot">加载失败</div>
                    </template>
                </el-image>
                <div class="success-tag">生成成功</div>
            </div>
        </div>

        <!-- 节点连接点 (Handle) -->
        <Handle type="target" :position="Position.Left" />
        <Handle type="source" :position="Position.Right" />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Picture } from '@element-plus/icons-vue';
import { generateImage } from '../../api/image';
import { ElMessage } from 'element-plus';

// 定义 Vue Flow 节点所需的 props
const props = defineProps<NodeProps>();

const { findNode, getEdges } = useVueFlow();


const prompt = ref('');
const size = ref('1024x1024');
const loading = ref(false);
const imageUrl = ref('');

const handleGenerate = async () => {
    if (!prompt.value) {
        ElMessage.warning('请输入提示词');
        return;
    }

    loading.value = true;
    try {
        // --- 核心逻辑变化开始 ---

        // 1. 查找连接到当前节点(target=props.id)的所有连线
        const edges = getEdges.value;
        const targetEdge = edges.find((e) => e.target === props.id);

        let finalPrompt = prompt.value; // 默认使用自身的输入

        // 2. 如果有连线，尝试获取上游节点的数据
        if (targetEdge) {
            const sourceNode = findNode(targetEdge.source);
            if (sourceNode && sourceNode.data && sourceNode.data.text) {
                finalPrompt = sourceNode.data.text;
                console.log(`🔗 检测到上游输入: ${finalPrompt}`);
            }
        }

        // 3. 校验最终提示词
        if (!finalPrompt) {
            ElMessage.warning('提示词为空！请在输入框填写或连接提示词节点。');
            loading.value = false;
            return;
        }

        // --- 核心逻辑变化结束 ---

        const [width, height] = size.value.split('x').map(Number);

        const res: any = await generateImage({
            apiType: 'dream',
            prompt: finalPrompt, // 使用 finalPrompt
            width,
            height
        });
        console.log('👉 后端原始返回:', res);
        // 后端返回格式: { message: "任务提交成功", data: { image_url: "...", ... } }
        if (res.data && res.data.image_url) {
            // 确保 URL 是完整的（如果后端返回的是相对路径，需要拼接）
            const url = res.data.image_url.startsWith('http')
                ? res.data.image_url
                : `${window.location.origin}${res.data.image_url}`;
            imageUrl.value = url;
            console.log('👉 完整图片URL:', url);
            ElMessage.success('图片生成成功！');
        } else {
            ElMessage.warning('生成成功，但未获取到图片URL');
        }
    } catch (error) {
        console.error(error);
    } finally {
        loading.value = false;
    }
};
</script>

<style scoped>
.dream-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    font-family: 'Helvetica Neue', Arial, sans-serif;
}

.node-header {
    background: linear-gradient(90deg, #6a11cb 0%, #2575fc 100%);
    color: white;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    gap: 8px;
}

.node-content {
    padding: 12px;
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

.result-image {
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #eee;
}

.img-preview {
    width: 100%;
    height: 200px;
    display: block;
}

.success-tag {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(103, 194, 58, 0.9);
    color: white;
    font-size: 12px;
    text-align: center;
    padding: 2px 0;
}
</style>