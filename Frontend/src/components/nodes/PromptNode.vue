<template>
    <div class="prompt-node">
      <div class="node-header">
        <el-icon><EditPen /></el-icon>
        <span>提示词输入</span>
      </div>
      
      <div class="node-content">
        <el-input
          v-model="text"
          type="textarea"
          :rows="4"
          placeholder="在这里输入提示词，并通过连线传给生图节点..."
          @change="updateData"
        />
      </div>
  
      <!-- 只有输出端口 (Source)，位于右侧 -->
      <Handle type="source" :position="Position.Right" />
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, watch, onMounted } from 'vue';
  import { Handle, Position, type NodeProps } from '@vue-flow/core';
  import { EditPen } from '@element-plus/icons-vue';
  
  const props = defineProps<NodeProps>();
  const text = ref(props.data?.text || '');
  
  // 当输入变化时，更新 VueFlow 内部的数据状态，以便后续节点读取
  const updateData = () => {
    props.data.text = text.value;
  };
  
  // 监听变化
  watch(text, (val) => {
    props.data.text = val;
  });
  </script>
  
  <style scoped>
  .prompt-node {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    width: 240px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.05);
    font-family: 'Helvetica Neue', Arial, sans-serif;
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
    padding: 12px;
  }
  </style>