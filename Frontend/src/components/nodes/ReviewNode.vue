<template>
    <div class="review-node">
        <div class="node-content">
            <div class="preview-row">
                <div class="preview-block">
                    <div class="preview-label">效果图</div>
                    <div class="preview-frame">
                        <img v-if="effectPreviewUrl" :src="effectPreviewUrl" alt="效果图" class="preview-img" />
                        <div v-else class="preview-empty">连接图片节点</div>
                    </div>
                </div>
                <div class="preview-block">
                    <div class="preview-label">需求图（可选，最多5张）</div>
                    <div class="req-grid">
                        <div v-for="(url, idx) in reqPreviewUrls" :key="`${url}-${idx}`" class="req-thumb">
                            <img :src="url" alt="需求图" />
                        </div>
                        <div v-if="reqPreviewUrls.length === 0" class="preview-empty req-empty">
                            从左侧「需求」接点连入图片
                        </div>
                    </div>
                </div>
            </div>

            <el-button
                type="primary"
                size="small"
                class="w-100 execute-btn"
                :loading="loading"
                :disabled="!effectImageUrl || loading"
                @click="handleReview"
            >
                {{ loading ? 'AI 评审中（约1-3分钟）...' : '执行审核' }}
            </el-button>

            <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

            <div v-if="result" class="result-panel nodrag nopan" @wheel.stop>
                <div class="result-head">
                    <span class="verdict" :class="verdictClass">{{ result.verdict || '—' }}</span>
                    <span class="score">
                        {{ result.weightedTotal ?? '—' }}
                        <span class="pass">/ {{ result.passLine ?? '—' }}</span>
                    </span>
                    <a
                        v-if="summaryDisplayUrl"
                        class="dl-link"
                        :href="summaryDisplayUrl"
                        target="_blank"
                        rel="noopener"
                        download
                    >⬇ 合成图</a>
                </div>

                <div v-if="result.vetoHits?.length" class="veto-row">
                    <span v-for="(v, i) in result.vetoHits" :key="i" class="veto-tag">{{ v }}</span>
                </div>

                <div v-if="annotatedDisplayUrl" class="anno-wrap" @click="openPreview(annotatedDisplayUrl)">
                    <img :src="annotatedDisplayUrl" alt="标注图" class="anno-img" />
                </div>

                <div v-if="result.reportHtml" class="report-html" v-html="result.reportHtml"></div>
            </div>
        </div>

        <Handle
            id="target"
            type="target"
            :position="Position.Left"
            :style="handleStyleEffect"
            title="效果图"
        />
        <Handle
            id="req"
            type="target"
            :position="Position.Left"
            :style="handleStyleReq"
            title="需求图"
        />
        <Handle
            id="source"
            type="source"
            :position="Position.Right"
            :style="handleStyleSource"
        />

        <el-dialog
            v-model="showFullscreen"
            :show-close="true"
            :close-on-click-modal="true"
            :close-on-press-escape="true"
            :append-to-body="true"
            width="100%"
            top="0"
            class="fullscreen-preview-dialog"
            @close="showFullscreen = false"
        >
            <div class="fullscreen-preview-container" @click="showFullscreen = false">
                <img v-if="previewUrl" :src="previewUrl" class="fullscreen-image" alt="预览" @click.stop />
            </div>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { ElMessage } from 'element-plus';
import { runImageReview, type ReviewResultData } from '@/api/review';
import { getUploadUrl, toPersistableImageUrl } from '@/utils/image-loader';

defineEmits<{ updateNodeInternals: [] }>();

type WorkflowPersistenceStore = {
    saveImmediately: () => void;
    markDirty?: () => void;
};

const props = defineProps<NodeProps>();
const { findNode, getEdges } = useVueFlow();
const workflowPersistence = inject<WorkflowPersistenceStore | null>('workflowPersistence', null);

const effectImageUrl = ref<string>(props.data?.imageUrl || props.data?.effectImageUrl || '');
const reqImageUrls = ref<string[]>(Array.isArray(props.data?.reqImageUrls) ? [...props.data.reqImageUrls] : []);
const loading = ref(false);
const errorMessage = ref('');
const result = ref<ReviewResultData | null>(props.data?.reviewResult || null);
const showFullscreen = ref(false);
const previewUrl = ref('');

const handleStyleEffect = {
    background: '#4ade80',
    width: '12px',
    height: '12px',
    border: '2px solid #1a1a1a',
    borderRadius: '50%',
    cursor: 'crosshair',
    top: '28%',
};
const handleStyleReq = {
    background: '#60a5fa',
    width: '12px',
    height: '12px',
    border: '2px solid #1a1a1a',
    borderRadius: '50%',
    cursor: 'crosshair',
    top: '58%',
};
const handleStyleSource = {
    background: '#409eff',
    width: '12px',
    height: '12px',
    border: '2px solid #1a1a1a',
    borderRadius: '50%',
    cursor: 'crosshair',
};

const pickImageFromNode = (node: any): string => {
    if (!node?.data) return '';
    const d = node.data;
    if (d.imageUrl) return String(d.imageUrl);
    if (d.image_url) return String(d.image_url);
    if (Array.isArray(d.imageUrls) && d.imageUrls[0]) return String(d.imageUrls[0]);
    if (Array.isArray(d.all_images) && d.all_images[0]) return String(d.all_images[0]);
    return '';
};

const sameUrlList = (a: string[], b: string[]) =>
    a.length === b.length && a.every((u, i) => u === b[i]);

/** 仅用边签名做依赖，避免 deep watch + 写 props.data 导致递归更新 */
const incomingEdgeSignature = computed(() =>
    getEdges.value
        .filter((e) => e.target === props.id)
        .map((e) => `${e.id}|${e.source}|${e.targetHandle || 'target'}`)
        .sort()
        .join(';')
);

const syncFromEdges = () => {
    const edges = getEdges.value.filter((e) => e.target === props.id);
    const effectEdge = edges.find((e) => !e.targetHandle || e.targetHandle === 'target');
    const reqEdges = edges.filter((e) => e.targetHandle === 'req');

    if (effectEdge) {
        const url = pickImageFromNode(findNode(effectEdge.source));
        if (url && url !== effectImageUrl.value) {
            effectImageUrl.value = url;
        }
    }

    const reqs: string[] = [];
    for (const edge of reqEdges) {
        const url = pickImageFromNode(findNode(edge.source));
        if (url && !reqs.includes(url)) reqs.push(url);
        if (reqs.length >= 5) break;
    }
    if (!sameUrlList(reqs, reqImageUrls.value)) {
        reqImageUrls.value = reqs;
    }
};

watch(incomingEdgeSignature, syncFromEdges, { immediate: true });

// 上游图片 URL 变化时再同步（不写 props，避免 Vue Flow 递归）
watch(
    () => {
        const edges = getEdges.value.filter((e) => e.target === props.id);
        return edges
            .map((e) => {
                const n = findNode(e.source);
                return `${e.targetHandle || 'target'}:${pickImageFromNode(n)}`;
            })
            .join(';');
    },
    syncFromEdges
);

const effectPreviewUrl = computed(() => (effectImageUrl.value ? getUploadUrl(effectImageUrl.value) : ''));
const reqPreviewUrls = computed(() => reqImageUrls.value.map((u) => getUploadUrl(u)).filter(Boolean));

const annotatedDisplayUrl = computed(() => {
    const u = result.value?.annotatedUrl;
    return u ? getUploadUrl(u) : '';
});
const summaryDisplayUrl = computed(() => {
    const u = result.value?.summaryImageUrl;
    return u ? getUploadUrl(u) : '';
});

const verdictClass = computed(() => {
    const v = String(result.value?.verdict || '');
    if (v.includes('通过') || v.includes('合格')) return 'good';
    if (v.includes('返工') || v.includes('打回')) return 'bad';
    return '';
});

const openPreview = (url: string) => {
    previewUrl.value = url;
    showFullscreen.value = true;
};

const handleReview = async () => {
    if (!effectImageUrl.value) {
        ElMessage.warning('请先连接效果图（左侧绿色接点）');
        return;
    }

    loading.value = true;
    errorMessage.value = '';
    try {
        const res: any = await runImageReview({
            effectImageUrl: effectImageUrl.value,
            reqImageUrls: reqImageUrls.value,
        });
        const data = res?.data as ReviewResultData;
        if (!data) {
            throw new Error(res?.message || '质检未返回结果');
        }

        // 持久化用相对路径，避免 COS 签名过期
        const normalized: ReviewResultData = {
            ...data,
            annotatedUrl: data.annotatedUrl ? toPersistableImageUrl(data.annotatedUrl) || data.annotatedUrl : null,
            summaryImageUrl: data.summaryImageUrl
                ? toPersistableImageUrl(data.summaryImageUrl) || data.summaryImageUrl
                : null,
        };
        result.value = normalized;
        // 仅在用户执行后写回节点 data（供工作流持久化），避免 watch 阶段改 props 触发递归
        Object.assign(props.data, {
            reviewResult: normalized,
            imageUrl: normalized.annotatedUrl || effectImageUrl.value,
            effectImageUrl: effectImageUrl.value,
            reqImageUrls: [...reqImageUrls.value],
        });
        ElMessage.success(`质检完成：${normalized.verdict || '已出结果'}`);
        workflowPersistence?.saveImmediately?.();
    } catch (error: any) {
        const msg =
            error?.response?.data?.message ||
            error?.message ||
            'AI 质检失败，请确认 qc_web 已启动';
        errorMessage.value = String(msg);
        ElMessage.error(String(msg));
    } finally {
        loading.value = false;
    }
};
</script>

<style scoped>
.review-node {
    width: 360px;
    background: #2d2d2d;
    border: 1px solid #3a3a40;
    border-radius: 10px;
    overflow: hidden;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.node-content {
    padding: 12px 14px 14px;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.preview-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.preview-label {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
}

.preview-frame {
    width: 100%;
    min-height: 72px;
    border: 1px dashed #4a4a50;
    border-radius: 6px;
    background: #252528;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 4px;
    box-sizing: border-box;
}

.preview-img {
    display: block;
    width: 100%;
    height: auto;
    max-height: none;
    object-fit: contain;
}

.preview-empty {
    font-size: 11px;
    color: #666;
    text-align: center;
    padding: 8px;
}

.req-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    min-height: 52px;
}

.req-thumb {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    background: #252528;
    border: 1px solid #3a3a40;
}

.req-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #1a1a1a;
}

.req-empty {
    grid-column: 1 / -1;
    border: 1px dashed #4a4a50;
    border-radius: 6px;
    background: #252528;
}

.execute-btn {
    width: 100%;
}

.error-box {
    font-size: 12px;
    color: #ff8a8a;
    background: #1e1010;
    border: 1px solid #2a1818;
    border-radius: 6px;
    padding: 8px 10px;
}

.result-panel {
    border-top: 1px solid #3a3a40;
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 640px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* 保证在 Vue Flow 画布上也能滚 */
    pointer-events: auto;
    cursor: default;
}

.result-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
}

.verdict {
    font-size: 13px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    background: #333;
}

.verdict.good {
    color: #4ade80;
    background: #102018;
    border: 1px solid #1a3a28;
}

.verdict.bad {
    color: #ff8a8a;
    background: #1e1010;
    border: 1px solid #2a1818;
}

.score {
    font-size: 14px;
    font-weight: 600;
    color: #e5e5e5;
}

.score .pass {
    font-size: 11px;
    color: #777;
    font-weight: 400;
}

.dl-link {
    margin-left: auto;
    font-size: 11px;
    color: #93c5fd;
    text-decoration: none;
}

.dl-link:hover {
    text-decoration: underline;
}

.veto-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex-shrink: 0;
}

.veto-tag {
    font-size: 9px;
    color: #ff8a8a;
    background: #1e1010;
    padding: 2px 7px;
    border-radius: 3px;
    border: 1px solid #2a1818;
}

.anno-wrap {
    cursor: zoom-in;
    border-radius: 6px;
    overflow: hidden;
    background: #111;
    flex-shrink: 0;
    width: 100%;
}

.anno-img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
}

.report-html {
    font-size: 11px;
    line-height: 1.5;
    color: #b0b0b0;
    min-height: 0;
}

.report-html :deep(img) {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
}

.report-html :deep(.result-anno),
.report-html :deep(img.result-anno) {
    width: 100%;
    height: auto;
}

.fullscreen-preview-dialog {
    margin: 0 !important;
}

.fullscreen-preview-dialog :deep(.el-dialog) {
    width: 100vw !important;
    height: 100vh !important;
    margin: 0 !important;
    background: rgba(0, 0, 0, 0.95) !important;
    border-radius: 0 !important;
}

.fullscreen-preview-container {
    width: 100%;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.fullscreen-image {
    max-width: 95vw;
    max-height: 95vh;
    object-fit: contain;
}
</style>
