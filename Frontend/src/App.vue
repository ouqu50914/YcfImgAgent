<script setup lang="ts">
</script>

<template>
  <router-view />
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  width: 100%;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
}

#app {
  min-height: 100vh;
  width: 100%;
}

/* 图片预览（el-image 预览、全屏预览）去掉滚动条 */
.el-image-viewer__wrapper,
.el-image-viewer__canvas {
  overflow: hidden !important;
}
</style>
