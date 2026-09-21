<template>
  <div class="image-collection-node">
    <div class="collection-header">
      <div class="header-left">
        <el-icon class="header-icon"><Picture /></el-icon>
        <span class="header-title">{{ titleText }}</span>
        <span class="header-count">{{ readyCount }}/{{ items.length }}</span>
      </div>
    </div>

    <div class="collection-grid nodrag nopan">
      <div
        v-for="item in sortedItems"
        :key="item.key"
        class="collection-cell"
        :class="{
          'is-loading': item.isLoading,
          'is-error': item.isError,
          'is-ready': !!item.imageUrl && !item.isLoading && !item.isError,
        }"
      >
        <div class="cell-label">{{ item.panelLabel || `镜 ${item.panelIndex}` }}</div>
        <div class="cell-frame">
          <div v-if="item.isLoading" class="cell-slot loading-slot" />
          <div v-else-if="item.isError" class="cell-slot error-slot">
            <span>失败</span>
          </div>
          <el-image
            v-else-if="item.imageUrl"
            :src="displayUrl(item.imageUrl)"
            fit="cover"
            class="cell-img"
            :preview-src-list="previewList"
            :initial-index="previewIndex(item)"
            preview-teleported
            hide-on-click-modal
          />
          <div v-else class="cell-slot empty-slot">
            <span>待生成</span>
          </div>
        </div>
      </div>
    </div>

    <Handle
      id="target"
      type="target"
      :position="Position.Left"
      class="handle-target"
      :style="{
        background: '#409eff',
        width: '12px',
        height: '12px',
        border: '2px solid #1a1a1a',
        borderRadius: '50%',
        cursor: 'crosshair',
        top: '50%',
      }"
    />
    <Handle
      id="image-source"
      type="source"
      :position="Position.Right"
      class="handle-source"
      :style="{
        background: '#555',
        width: '12px',
        height: '12px',
        border: '2px solid white',
        borderRadius: '50%',
        cursor: 'crosshair',
        top: '50%',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Picture } from '@element-plus/icons-vue';
import { getUploadUrl } from '@/utils/image-loader';

export type ImageCollectionItem = {
  key: string;
  panelIndex: number;
  panelLabel?: string;
  prompt?: string;
  imageUrl?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  generationKey?: string;
};

const props = defineProps<NodeProps>();
const { getEdges, addEdges, findNode } = useVueFlow();

const items = computed<ImageCollectionItem[]>(() => {
  const raw = (props.data as any)?.items;
  return Array.isArray(raw) ? raw : [];
});

const sortedItems = computed(() =>
  [...items.value].sort((a, b) => (a.panelIndex || 0) - (b.panelIndex || 0))
);

const titleText = computed(() => String((props.data as any)?.title || '分镜集合'));

const readyCount = computed(
  () => items.value.filter((x) => x.imageUrl && !x.isLoading && !x.isError).length
);

const displayUrl = (url: string) => getUploadUrl(url) || url;

const previewList = computed(() =>
  sortedItems.value
    .filter((x) => x.imageUrl && !x.isLoading && !x.isError)
    .map((x) => displayUrl(String(x.imageUrl)))
);

const previewIndex = (item: ImageCollectionItem) => {
  const url = item.imageUrl ? displayUrl(item.imageUrl) : '';
  const idx = previewList.value.indexOf(url);
  return idx >= 0 ? idx : 0;
};

/** 若有 fromNodeId（生图节点）且尚未连线，自动补上追源边 */
const ensureEdgeFromDream = () => {
  const fromId = String((props.data as any)?.fromNodeId || (props.data as any)?.sourceDreamNodeId || '');
  if (!fromId) return;
  const src = findNode(fromId);
  if (!src || src.type !== 'dream') return;
  const existed = getEdges.value.some((e) => e.source === fromId && e.target === props.id);
  if (existed) return;
  addEdges({
    id: `edge_${fromId}_to_${props.id}_ensure`,
    source: fromId,
    target: props.id,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'default',
    animated: true,
  });
};

onMounted(() => {
  ensureEdgeFromDream();
});
</script>

<style scoped>
.image-collection-node {
  display: inline-block;
  width: max-content;
  max-width: calc(4 * 148px + 3 * 10px + 24px);
  min-width: 0;
  padding: 10px 12px 12px;
  background: #1a1b1f;
  border: 1px solid #2e3038;
  border-radius: 8px;
  color: #e0e0e0;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.28);
  box-sizing: border-box;
}

.collection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.header-icon {
  color: #8ab4ff;
  flex-shrink: 0;
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: #ececec;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-count {
  flex-shrink: 0;
  font-size: 11px;
  color: #9a9a9a;
  padding: 1px 6px;
  border: 1px solid #3a3c44;
  border-radius: 4px;
}

.collection-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-content: flex-start;
  width: max-content;
  max-width: calc(4 * 148px + 3 * 10px);
}

.collection-cell {
  width: 148px;
  flex: 0 0 148px;
  cursor: pointer;
}

.cell-label {
  font-size: 11px;
  color: #8ab4ff;
  margin-bottom: 4px;
  padding-left: 2px;
}

.cell-frame {
  position: relative;
  width: 148px;
  height: 198px;
  border-radius: 6px;
  overflow: hidden;
  background: #121318;
  border: 1px solid #2c2e36;
}

.cell-img {
  width: 100%;
  height: 100%;
  display: block;
}

.cell-slot {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  color: #8a8a8a;
}

.loading-slot {
  background: linear-gradient(90deg, #1c1d22 0%, #262830 50%, #1c1d22 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.error-slot {
  color: #f56c6c;
  background: #1e1515;
}

.empty-slot {
  color: #666;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
</style>
