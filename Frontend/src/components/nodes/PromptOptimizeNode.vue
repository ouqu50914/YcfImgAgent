<template>
    <div class="prompt-optimize-node">
        <!-- 顶部标题 -->
        <div class="node-header">
            <el-icon>
                <MagicStick />
            </el-icon>
            <span>提示词润色</span>
        </div>

        <!-- 内容区域 -->
        <div class="node-content">
            <!-- 原提示词输入 -->
            <el-input
                v-model="originalPrompt"
                type="textarea"
                :rows="3"
                placeholder="输入原始提示词..."
                class="mb-2"
            />

            <!-- API选择（用于优化偏好） -->
            <el-select v-model="apiType" placeholder="优化偏好" class="mb-2" size="small">
                <el-option label="即梦AI优化" value="dream" />
                <el-option label="Nano优化" value="nano" />
            </el-select>

            <!-- 风格选择（可选） -->
            <el-select v-model="style" placeholder="风格（可选）" class="mb-2" size="small" clearable>
                <el-option label="赛博朋克" value="cyberpunk" />
                <el-option label="动漫风格" value="anime" />
                <el-option label="写实风格" value="realistic" />
                <el-option label="艺术风格" value="artistic" />
            </el-select>

            <!-- 优化按钮 -->
            <el-button
                type="primary"
                size="small"
                class="w-100"
                :loading="loading"
                :disabled="!originalPrompt"
                @click="handleOptimize"
            >
                {{ loading ? '优化中...' : '开始优化' }}
            </el-button>

            <!-- 优化结果展示 -->
            <div v-if="optimizedPrompt" class="result-section mt-2">
                <div class="result-label">优化后的提示词：</div>
                <el-input
                    v-model="optimizedPrompt"
                    type="textarea"
                    :rows="3"
                    readonly
                    class="result-textarea"
                />
                <el-button
                    size="small"
                    class="w-100 mt-2"
                    @click="copyToClipboard"
                >
                    复制优化结果
                </el-button>
            </div>
        </div>

        <!-- 节点连接点 -->
        <Handle type="target" :position="Position.Left" />
        <Handle type="source" :position="Position.Right" />
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { MagicStick } from '@element-plus/icons-vue';
import { optimizePrompt } from '../../api/prompt';
import { ElMessage } from 'element-plus';

const props = defineProps<NodeProps>();

const { findNode, getEdges } = useVueFlow();

const originalPrompt = ref('');
const apiType = ref<'dream' | 'nano'>('dream');
const style = ref('');
const loading = ref(false);
const optimizedPrompt = ref('');

// 监听上游节点连接
watch(
    () => getEdges.value,
    (edges) => {
        const targetEdge = edges.find((e) => e.target === props.id);
        if (targetEdge) {
            const sourceNode = findNode(targetEdge.source);
            if (sourceNode && sourceNode.data?.text) {
                originalPrompt.value = sourceNode.data.text;
            }
        }
    },
    { immediate: true, deep: true }
);

const handleOptimize = async () => {
    if (!originalPrompt.value.trim()) {
        ElMessage.warning('请输入提示词');
        return;
    }

    loading.value = true;
    try {
        const res: any = await optimizePrompt({
            prompt: originalPrompt.value,
            apiType: apiType.value,
            style: style.value || undefined
        });

        if (res.data && res.data.optimized) {
            optimizedPrompt.value = res.data.optimized;
            // 更新节点数据，供下游节点使用
            props.data.text = res.data.optimized;
            ElMessage.success('提示词优化成功！');
        } else {
            ElMessage.warning('优化成功，但未获取到结果');
        }
    } catch (error: any) {
        console.error(error);
        ElMessage.error(error.message || '提示词优化失败');
    } finally {
        loading.value = false;
    }
};

const copyToClipboard = async () => {
    if (!optimizedPrompt.value) return;
    
    try {
        await navigator.clipboard.writeText(optimizedPrompt.value);
        ElMessage.success('已复制到剪贴板');
    } catch (error) {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = optimizedPrompt.value;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        ElMessage.success('已复制到剪贴板');
    }
};
</script>

<style scoped>
.prompt-optimize-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    font-family: 'Helvetica Neue', Arial, sans-serif;
}

.node-header {
    background: linear-gradient(90deg, #fa709a 0%, #fee140 100%);
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

.result-section {
    border-top: 1px solid #eee;
    padding-top: 8px;
}

.result-label {
    font-size: 12px;
    color: #666;
    margin-bottom: 4px;
}

.result-textarea {
    font-size: 12px;
}

.result-textarea :deep(.el-textarea__inner) {
    background-color: #f9f9f9;
    font-size: 12px;
}
</style>
