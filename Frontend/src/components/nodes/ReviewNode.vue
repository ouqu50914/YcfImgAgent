<template>
    <div class="review-node">
        <div class="node-content">
            <div class="effect-status" :class="{ connected: !!effectPreviewUrl }">
                <span class="status-dot" />
                {{ effectPreviewUrl ? '效果图已连接' : '请从左侧绿色接点连入效果图' }}
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

                <div
                    v-if="compositeDisplayUrl"
                    class="composite-wrap"
                    @click="openPreview(compositeDisplayUrl)"
                >
                    <img :src="compositeDisplayUrl" alt="合成图" class="composite-img" />
                </div>

                <div v-if="displayReportHtml" class="report-html" v-html="displayReportHtml"></div>
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
    top: '18%',
};
const handleStyleReq = {
    background: '#60a5fa',
    width: '12px',
    height: '12px',
    border: '2px solid #1a1a1a',
    borderRadius: '50%',
    cursor: 'crosshair',
    top: '42%',
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
/** 节点内预览优先标注图（合成图走下载）；按内容自适应，限制高度避免横向铺满 */
const compositeDisplayUrl = computed(() => annotatedDisplayUrl.value || summaryDisplayUrl.value);

const SCORE_LABELS_ZH: Record<string, string> = {
    composition: '构图',
    color: '色彩',
    lighting: '光影',
    subject: '主体',
    craft: '完成度',
    text_typo: '文字排版',
    selling_point: '卖点传达',
    creativity: '创意',
    persp_prop: '透视比例',
};

const BOX_COLORS_CSS = [
    '#e63c3c',
    '#2563eb',
    '#eab308',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#14b8a6',
    '#ec4899',
];

const COORD_PCT_RE =
    /(?:\|\s*)?(?:坐标\s*[：:]?\s*)?\d{1,3}(?:\.\d+)?%\s*[,，]\s*\d{1,3}(?:\.\d+)?%\s*[,，]\s*\d{1,3}(?:\.\d+)?%\s*[,，]\s*\d{1,3}(?:\.\d+)?%/g;

/** 明确不合格判定词（始终可标红） */
const FAIL_VERDICT_RE = /(不符合|不正确|不合格)/;
/** 其余负面词：需避开否定语境，且「符合」条目整段不标 */
const BAD_KW_RE = /(不符合|不正确|不合格|有问题|缺失|错误|乱码|异常|返工|打回|未达成|偏离)/g;
const NEG_BEFORE_RE = /(?:没有|并无|并非|不是|不会|不存在|无明显|没有明显|无|未)$/;

const stripCoords = (text: string) =>
    String(text || '')
        .replace(COORD_PCT_RE, '')
        .replace(/(?:\|\s*)?坐标\s*[：:]?\s*[\d.%,，\s]+/g, '')
        .replace(/\s*\|\s*$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

const escapeHtml = (s: string) =>
    String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/** 对照条目：冒号后「符合」为通过；出现不符合/不正确/不合格为不通过 */
const checkItemVerdict = (text: string): 'pass' | 'fail' | 'unknown' => {
    const t = String(text || '');
    if (FAIL_VERDICT_RE.test(t)) return 'fail';
    if (/[：:]\s*符合/.test(t)) return 'pass';
    return 'unknown';
};

/**
 * 标红规则：
 * - 通过条目（：符合）：不标红，避免「没有偏离」里的「偏离」误伤
 * - 不通过条目：从首个「不符合/不正确/不合格」起整段标红
 * - 其它文本：关键字标红，但跳过否定前缀（没有/并非/无…）
 */
const markBadHtml = (escaped: string, verdict: 'pass' | 'fail' | 'unknown' = 'unknown') => {
    if (verdict === 'pass') return escaped;
    if (verdict === 'fail') {
        const m = escaped.match(FAIL_VERDICT_RE);
        if (m && m.index != null) {
            const i = m.index;
            return `${escaped.slice(0, i)}<span class="bad-kw">${escaped.slice(i)}</span>`;
        }
    }
    return escaped.replace(BAD_KW_RE, (match, _g1, offset, whole) => {
        if (/^(不符合|不正确|不合格|未达成)$/.test(match)) {
            return `<span class="bad-kw">${match}</span>`;
        }
        const before = String(whole).slice(Math.max(0, offset - 8), offset);
        if (NEG_BEFORE_RE.test(before)) return match;
        return `<span class="bad-kw">${match}</span>`;
    });
};

const splitNumberedSegments = (text: string): string[] => {
    const cleaned = stripCoords(text).trim();
    if (!cleaned) return [];
    const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const numbered = lines.filter((l) => /^\d+\s*[\.、)）:：]/.test(l));
    if (numbered.length >= 2) {
        const segs: string[] = [];
        for (const l of lines) {
            if (/^\d+\s*[\.、)）:：]/.test(l) || l.startsWith('综合判定')) segs.push(l);
            else if (segs.length) segs[segs.length - 1] += ` ${l}`;
            else segs.push(l);
        }
        return segs;
    }
    const parts = cleaned.split(/(?=\d+\s*[\.、)）:：])/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
    return [cleaned];
};

const formatTextBodyHtml = (text: string): string => {
    const segs = splitNumberedSegments(text);
    if (!segs.length) return '<div class="text-body">（无）</div>';
    if (segs.length === 1 && !/^\d+\s*[\.、)）:：]/.test(segs[0] || '')) {
        const s0 = segs[0] || '';
        return `<div class="text-body">${markBadHtml(escapeHtml(s0), checkItemVerdict(s0)).replace(/\n/g, '<br>')}</div>`;
    }
    return `<div class="check-list">${segs
        .map((s) => {
            const v = checkItemVerdict(s);
            return `<div class="check-item">${markBadHtml(escapeHtml(s), v)}</div>`;
        })
        .join('')}</div>`;
};

/** 把管道格式问题行拆成结构化卡片 HTML（带标注色块） */
const buildIssueCardHtml = (rawLine: string, idx = 0): string | null => {
    const line = stripCoords(rawLine).trim();
    if (!line) return null;
    const color = BOX_COLORS_CSS[idx % BOX_COLORS_CSS.length];
    const swatch = `<span class="issue-swatch" style="background:${color};border-color:${color}"></span>`;
    const parts = line.split('|').map((p) => p.trim());
    const wrap = (pos: string, reason: string, fix: string) =>
        `<div class="issue-card"><div class="issue-idx" style="color:${color}">#${idx + 1}</div><div class="issue-body">
            <div class="issue-row"><span class="issue-label">位置</span><span class="issue-value">${swatch}<b>${escapeHtml(pos)}</b></span></div>
            <div class="issue-row"><span class="issue-label">问题描述</span><span class="issue-value reason">${markBadHtml(escapeHtml(reason))}</span></div>
            <div class="issue-row"><span class="issue-label">解决方案</span><span class="issue-value fix">${escapeHtml(fix)}</span></div>
        </div></div>`;

    if (parts.length >= 3 && /^\d+$/.test(parts[0] || '')) {
        return wrap(parts[1] || '', parts[2] || '', parts[3] || '');
    }
    if (parts.length >= 3) {
        return wrap(parts[0] || '', parts[1] || '', parts[2] || '');
    }
    return null;
};

/**
 * 前端兜底清洗已缓存的 reportHtml：
 * - 维度名英→中、坐标去掉、管道问题结构化
 * - 需求对照等按 1.2.3 分段、不符合标红
 * - 问题色块、图片自适应
 */
const sanitizeReportHtml = (html: string): string => {
    if (!html || typeof DOMParser === 'undefined') return html;
    try {
        const doc = new DOMParser().parseFromString(`<div id="qc-root">${html}</div>`, 'text/html');
        const root = doc.getElementById('qc-root');
        if (!root) return html;

        root.querySelectorAll('.score-name').forEach((el) => {
            const key = (el.textContent || '').trim();
            if (SCORE_LABELS_ZH[key]) el.textContent = SCORE_LABELS_ZH[key];
        });

        root.querySelectorAll('img').forEach((img) => {
            const el = img as HTMLImageElement;
            el.style.width = 'auto';
            el.style.maxWidth = '100%';
            el.style.maxHeight = '420px';
            el.style.height = 'auto';
            el.style.objectFit = 'contain';
            el.style.display = 'block';
            el.style.margin = '0 auto';
        });

        // 需求对照 / 文字检查等：连写序号 → 分段列表
        root.querySelectorAll('.text-body').forEach((el) => {
            const text = (el.textContent || '').trim();
            if (!text) return;
            if (
                /^\d+\s*[\.、)）:：]/.test(text) ||
                (text.match(/\d+\s*[\.、)）:：]/g) || []).length >= 2
            ) {
                el.outerHTML = formatTextBodyHtml(text);
            } else {
                const cleaned = stripCoords(text);
                el.innerHTML = markBadHtml(escapeHtml(cleaned), checkItemVerdict(cleaned)).replace(/\n/g, '<br>');
            }
        });

        // 已分段的对照条目：按符合/不符合重算标红（修复缓存里「没有偏离」误红）
        root.querySelectorAll('.check-item').forEach((el) => {
            const text = stripCoords(el.textContent || '');
            if (!text) return;
            el.innerHTML = markBadHtml(escapeHtml(text), checkItemVerdict(text));
        });

        // 扁平 issue-text → 结构化卡片
        let issueIdx = 0;
        root.querySelectorAll('.issue-text').forEach((el) => {
            const text = (el.textContent || '').trim();
            const card = buildIssueCardHtml(text, issueIdx);
            if (!card) {
                el.textContent = stripCoords(text);
                return;
            }
            issueIdx += 1;
            const wrap = el.closest('.issue-card') || el;
            wrap.outerHTML = card;
        });

        root.querySelectorAll('.issues-list').forEach((list) => {
            if (list.querySelector('.issue-row')) {
                // 已有结构化：补色块
                list.querySelectorAll('.issue-card').forEach((card, i) => {
                    const color = BOX_COLORS_CSS[i % BOX_COLORS_CSS.length];
                    if (!card.querySelector('.issue-swatch')) {
                        const posVal = card.querySelector('.issue-row .issue-value');
                        if (posVal && !posVal.querySelector('.issue-swatch')) {
                            posVal.insertAdjacentHTML(
                                'afterbegin',
                                `<span class="issue-swatch" style="background:${color};border-color:${color}"></span>`
                            );
                        }
                    }
                    if (!card.querySelector('.issue-idx')) {
                        card.insertAdjacentHTML(
                            'afterbegin',
                            `<div class="issue-idx" style="color:${color}">#${i + 1}</div>`
                        );
                    }
                });
                return;
            }
            const raw = (list.textContent || '').trim();
            if (!raw.includes('|')) return;
            const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
            const cards = lines
                .map((l, i) => buildIssueCardHtml(l, i))
                .filter(Boolean) as string[];
            if (cards.length > 0) list.innerHTML = cards.join('');
        });

        // 其它段落：剥坐标 + 标红
        root.querySelectorAll('.prob-item, .prob-summary, .alert').forEach((el) => {
            const t = el.textContent || '';
            const cleaned = stripCoords(t);
            el.innerHTML = markBadHtml(escapeHtml(cleaned));
        });

        return root.innerHTML;
    } catch {
        return html;
    }
};

const displayReportHtml = computed(() => {
    const html = result.value?.reportHtml || '';
    return html ? sanitizeReportHtml(html) : '';
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
    width: 648px;
    background: #2d2d2d;
    border: 1px solid #3a3a40;
    border-radius: 10px;
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    box-shadow: none;
}

.review-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.review-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

.node-content {
    padding: 12px 14px 14px;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.effect-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #888;
    padding: 8px 10px;
    border-radius: 6px;
    background: #252528;
    border: 1px dashed #4a4a50;
}

.effect-status.connected {
    color: #86efac;
    border-style: solid;
    border-color: #1a3a28;
    background: #102018;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    flex-shrink: 0;
}

.effect-status.connected .status-dot {
    background: #4ade80;
}

.preview-label {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
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
    max-height: 720px;
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

.composite-wrap {
    cursor: zoom-in;
    border-radius: 6px;
    overflow: hidden;
    background: transparent;
    flex-shrink: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
}

.composite-img {
    display: block;
    width: auto;
    max-width: min(100%, 480px);
    max-height: 360px;
    height: auto;
    object-fit: contain;
    border-radius: 6px;
    background: #111;
}

.report-html {
    font-size: 12px;
    line-height: 2;
    color: #bbb;
    min-height: 0;
    user-select: text;
}

.report-html :deep(.qc-report) {
    font-size: 12px;
    line-height: 2;
    color: #bbb;
}

.report-html :deep(.qc-section) {
    margin-bottom: 20px;
}

.report-html :deep(.section-title) {
    font-size: 11px;
    font-weight: 600;
    color: #ccc;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 7px;
    border-bottom: 1px solid #1a1a1a;
    letter-spacing: 0.5px;
}

.report-html :deep(.section-count) {
    font-size: 9px;
    color: #666;
    font-weight: 400;
}

.report-html :deep(.ok-tip) {
    font-size: 10.5px;
    color: #6adf9a;
    background: #101a12;
    border: 1px solid #1a2a1e;
    border-radius: 4px;
    padding: 6px 10px;
    margin-top: 6px;
    text-align: center;
}

.report-html :deep(.detected-list) {
    font-size: 10px;
    color: #555;
    padding: 6px 10px;
    line-height: 1.7;
    margin-top: 4px;
    text-align: center;
}

.report-html :deep(.issues-list) {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.report-html :deep(.issue-card) {
    display: flex;
    gap: 12px;
    background: #252528;
    border: 1px solid #3a3a40;
    border-radius: 6px;
    padding: 14px 16px;
    align-items: flex-start;
}

.report-html :deep(.issue-idx) {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    padding-top: 2px;
    min-width: 28px;
}

.report-html :deep(.issue-swatch) {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid;
    margin-right: 8px;
    flex-shrink: 0;
    align-self: center;
}

.report-html :deep(.issue-body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.report-html :deep(.issue-row) {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}

.report-html :deep(.issue-label) {
    flex-shrink: 0;
    font-size: 10px;
    color: #888;
    min-width: 56px;
    padding-top: 3px;
    font-weight: 600;
}

.report-html :deep(.issue-value) {
    font-size: 12px;
    color: #ccc;
    flex: 1;
    line-height: 1.9;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    min-width: 0;
}

.report-html :deep(.issue-value.reason) {
    color: #ff8a8a;
}

.report-html :deep(.issue-value.fix) {
    color: #8bc8ea;
    font-weight: 500;
}

.report-html :deep(.issue-value b) {
    color: #fff;
    font-weight: 600;
}

.report-html :deep(.check-list) {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.report-html :deep(.check-item) {
    font-size: 11.5px;
    color: #aaa;
    line-height: 1.8;
    background: #252528;
    padding: 10px 14px;
    border-radius: 5px;
    border: 1px solid #3a3a40;
    word-break: break-word;
}

.report-html :deep(.bad-kw) {
    color: #ff8a8a;
    font-weight: 600;
}

.report-html :deep(.text-body) {
    font-size: 11.5px;
    color: #aaa;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 2;
    background: #252528;
    padding: 14px 16px;
    border-radius: 5px;
    border: 1px solid #3a3a40;
}

.report-html :deep(.issue-text) {
    font-size: 12px;
    color: #ccc;
    line-height: 2;
}

.report-html :deep(.score-grid) {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

.report-html :deep(.score-item) {
    background: #252528;
    border: 1px solid #3a3a40;
    border-radius: 5px;
    padding: 10px 12px;
}

.report-html :deep(.score-top) {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5px;
}

.report-html :deep(.score-name) {
    font-size: 9px;
    color: #777;
}

.report-html :deep(.score-val) {
    font-size: 15px;
    font-weight: 700;
    color: #ddd;
}

.report-html :deep(.score-val.low) {
    color: #ff8a8a;
}

.report-html :deep(.score-bar) {
    height: 3px;
    background: #1a1a20;
    border-radius: 2px;
    overflow: hidden;
}

.report-html :deep(.score-fill) {
    height: 100%;
    background: #555;
    border-radius: 2px;
}

.report-html :deep(.score-fill.low) {
    background: #553333;
}

.report-html :deep(.prob-list) {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.report-html :deep(.prob-item) {
    font-size: 11.5px;
    padding: 8px 12px;
    background: #141010;
    border-left: 2px solid #553333;
    border-radius: 0 4px 4px 0;
    color: #cc9999;
    line-height: 1.9;
}

.report-html :deep(.prob-summary) {
    font-size: 11px;
    font-weight: 600;
    padding: 8px 12px;
    border-radius: 4px;
    margin-top: 8px;
}

.report-html :deep(.prob-summary.bad) {
    color: #ff8a8a;
    background: #1a1010;
    border: 1px solid #2a1818;
}

.report-html :deep(.req-understanding) {
    margin-bottom: 12px;
}

.report-html :deep(.req-und-title) {
    font-size: 11px;
    font-weight: 600;
    color: #8ab4f8;
    margin-bottom: 6px;
    padding-left: 2px;
}

.report-html :deep(.req-und-body) {
    font-size: 11px;
    line-height: 1.9;
    color: #999;
    background: #1e2535;
    border-color: #2a3550;
}

.report-html :deep(.langs) {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.report-html :deep(.lang-tag) {
    background: #252528;
    color: #999;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 10.5px;
    border: 1px solid #3a3a40;
}

.report-html :deep(.alert) {
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 11px;
    margin-bottom: 5px;
    line-height: 1.9;
}

.report-html :deep(.alert.bad) {
    background: #1a1010;
    color: #ff8a8a;
    border-left: 2px solid #553333;
}

.report-html :deep(.alert.warn) {
    background: #1a1510;
    color: #ccaa66;
    border-left: 2px solid #554433;
}

.report-html :deep(.alert.info) {
    background: #10151a;
    color: #88aacc;
    border-left: 2px solid #334455;
}

.report-html :deep(img) {
    display: block;
    width: auto !important;
    max-width: min(100%, 480px) !important;
    max-height: 360px;
    height: auto !important;
    margin: 0 auto;
    object-fit: contain;
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
