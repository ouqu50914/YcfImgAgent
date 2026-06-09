<template>
  <div class="workflow-chat-popup-page">
    <WorkflowChatPanel mode="popup" />
  </div>
</template>

<script setup lang="ts">
import WorkflowChatPanel from '@/components/WorkflowChatPanel.vue';
</script>

<style scoped>
.workflow-chat-popup-page {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--app-bg);
}
</style>
