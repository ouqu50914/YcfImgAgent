<template>
    <div class="dream-node">
        <!-- 顶部标题（与参考图一致） -->
        <div class="node-header">
            <span>模型参数</span>
        </div>
        <!-- 内容区域 -->
        <div class="node-content">
            <!-- nodrag：避免在控件上按下鼠标时触发节点拖拽，导致按钮点不到 -->
            <div class="params-section nodrag">
                
                <!-- 模型选择 -->
                <div class="param-item">
                    <div class="param-label">模型</div>
                    <el-select v-model="selectedModel" placeholder="选择模型" size="small" class="param-select model-select">
                        <el-option
                            v-for="option in availableModelOptions"
                            :key="option.value"
                            :label="option.label"
                            :value="option.value"
                        />
                    </el-select>
                </div>

                <!-- 生成数量 -->
                <div class="param-item">
                    <div class="param-label">生成数量</div>
                    <el-select v-model="numImages" placeholder="生成数量" size="small" class="param-select">
                        <el-option label="1" :value="1" />
                        <el-option label="2" :value="2" />
                        <el-option label="3" :value="3" />
                        <el-option label="4" :value="4" />
                    </el-select>
                </div>

                <!-- 分辨率设置 -->
                <div class="param-item">
                    <div class="param-label">分辨率</div>
                    <el-select 
                        v-model="quality" 
                        placeholder="画质" 
                        size="small" 
                        class="param-select" 
                        :disabled="!availableResolutions.length || isGemini3ProModel"
                    >
                        <el-option 
                            v-for="res in availableResolutions" 
                            :key="res" 
                            :label="res === 'standard' ? '标准画质' : res" 
                            :value="res" 
                        />
                    </el-select>
                </div>

                <!-- 图片比例 -->
                <div class="param-item">
                    <div class="param-label">图片比例</div>
                    <el-select 
                        v-model="aspectRatio" 
                        placeholder="比例" 
                        size="small" 
                        class="param-select"
                    >
                        <el-option 
                            v-for="ratio in availableAspectRatios" 
                            :key="ratio" 
                            :label="ratio" 
                            :value="ratio" 
                        />
                    </el-select>
                </div>

                <!-- 执行按钮（禁用原因多为积分/参考图；提示词在点击后校验，见 executeBlockedHint） -->
                <el-tooltip :content="executeBlockedHint" placement="top" :disabled="canExecute">
                    <span class="execute-btn-tooltip-anchor">
                        <el-button
                            type="primary"
                            size="default"
                            class="execute-btn"
                            :loading="loading"
                            :disabled="!canExecute"
                            @click="handleGenerate"
                        >
                            {{ executeButtonText }}
                        </el-button>
                    </span>
                </el-tooltip>
            </div>
        </div>

        <!-- 节点连接点 (Handle) -->
        <Handle 
            id="target" 
            type="target" 
            :position="Position.Left" 
            :style="{ 
                background: '#409eff', 
                width: '12px', 
                height: '12px', 
                border: '2px solid #1a1a1a',
                borderRadius: '50%',
                cursor: 'crosshair',
                top: '50%'
            }"
        />
        <!-- 输出端口 -->
        <Handle 
            id="source" 
            type="source" 
            :position="Position.Right" 
            :style="{ 
                background: '#555', 
                width: '12px', 
                height: '12px', 
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair'
            }"
        />
    </div>

    <!-- 全屏图片预览 -->
    <el-dialog
        v-model="showFullscreenPreview"
        :show-close="true"
        :close-on-click-modal="true"
        :close-on-press-escape="true"
        :append-to-body="true"
        :modal="true"
        :modal-append-to-body="true"
        width="100%"
        top="0"
        class="fullscreen-preview-dialog"
        @close="showFullscreenPreview = false"
    >
        <div class="fullscreen-preview-container" @click="showFullscreenPreview = false">
            <img :src="previewImageUrl" class="fullscreen-image" alt="预览图片" />
        </div>
    </el-dialog>

</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, inject, type Ref } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Picture, InfoFilled, CircleCheck } from '@element-plus/icons-vue';
import { generateImage, getImageGenerateResultByGenerationKey } from '../../api/image';
import { uploadImage } from '../../api/upload';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import { getCreditCost } from '@/utils/credits';
import { getUploadUrl } from '@/utils/image-loader';
import { notifyMediaGeneration } from '@/utils/browser-notification';
import { summarizeConnectedImages, type ImageNodeLikeData } from '@/utils/media-ready';

// 声明 emits 以消除 Vue Flow 的警告
defineEmits<{
    updateNodeInternals: [];
}>();

// 定义 Vue Flow 节点所需的 props
const props = defineProps<NodeProps>();

type WorkflowPersistenceStore = {
    saveImmediately: () => void;
};

type CreditTrackerStore = {
    addSpent: (amount: number) => void;
    getTotalSpent: () => number;
};

const { findNode, getEdges, addNodes, addEdges, getNodes, setNodes } = useVueFlow();
const userStore = useUserStore();
const creditTracker = inject<CreditTrackerStore | null>('creditTracker', null);
const workflowTemplateId = inject<Ref<number | null> | null>('workflowTemplateId', null);
const isSuperAdmin = computed(() => userStore.userInfo?.role === 1);
const ANYFAST_PRO_MODEL = 'anyfast:gemini-3-pro-image-preview';
const DEFAULT_ALLOWED_NANO_MODEL = 'anyfast:gemini-3.1-flash-image-preview';
const ALL_MODEL_OPTIONS = [
    { label: 'Seedream', value: 'dream' },
    { label: 'Midjourney', value: 'midjourney' },
    { label: 'NanoBanana2(ace)（6/张）', value: 'nano:nano-banana-2' },
    { label: 'NanoBanana Pro(ace)（6/张）', value: 'nano:nano-banana-pro' },
    { label: 'NanoBanana2(anyfast)（2K:11/张，4K:15/张）', value: 'anyfast:gemini-3.1-flash-image-preview' },
    { label: 'NanoBanana Pro(anyfast)（2K:15/张，4K:20/张）', value: ANYFAST_PRO_MODEL },
] as const;
const availableModelOptions = computed(() => {
    if (isSuperAdmin.value) return ALL_MODEL_OPTIONS;
    return ALL_MODEL_OPTIONS.filter(option => option.value !== ANYFAST_PRO_MODEL);
});

const extractTextFromPromptDoc = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof n.type === 'string' && n.type === 'text' && typeof n.text === 'string') {
        return n.text;
    }
    if (!Array.isArray(n.content)) return '';
    const parts: string[] = [];
    for (const child of n.content) {
        const t = extractTextFromPromptDoc(child);
        if (t) parts.push(t);
    }
    return parts.join('\n');
};

const getPromptTextFromNodeData = (data: unknown): string => {
    if (!data || typeof data !== 'object') return '';
    const d = data as { text?: unknown; promptDoc?: unknown };
    if (typeof d.text === 'string' && d.text.trim()) return d.text.trim();
    const fromDoc = extractTextFromPromptDoc(d.promptDoc).trim();
    return fromDoc;
};

const logFrontendE2ETiming = (
    stage: 'request_started' | 'response_received' | 'ui_data_bound' | 'first_image_rendered' | 'first_image_render_failed',
    traceId: string,
    requestStartMs: number,
    extra?: Record<string, unknown>
) => {
    const totalMs = performance.now() - requestStartMs;
    console.log("[DreamNode][Timing][E2E]", {
        trace_id: traceId,
        stage,
        total_ms: Number(totalMs.toFixed(1)),
        total_seconds: Number((totalMs / 1000).toFixed(3)),
        ...(extra || {}),
    });
};

const logFirstImageLoadTiming = (imageUrl: string, traceId: string, requestStartMs: number) => {
    if (!imageUrl) return;
    const loadStart = performance.now();
    const img = new Image();
    img.onload = () => {
        const loadElapsed = performance.now() - loadStart;
        const endToEndElapsed = performance.now() - requestStartMs;
        logFrontendE2ETiming('first_image_rendered', traceId, requestStartMs, {
            image_url: imageUrl,
            image_load_ms: Number(loadElapsed.toFixed(1)),
            end_to_end_ms: Number(endToEndElapsed.toFixed(1)),
        });
    };
    img.onerror = () => {
        const loadElapsed = performance.now() - loadStart;
        logFrontendE2ETiming('first_image_render_failed', traceId, requestStartMs, {
            image_url: imageUrl,
            image_load_ms: Number(loadElapsed.toFixed(1)),
        });
        console.warn("[DreamNode][Timing] 首图加载失败", {
            trace_id: traceId,
            image_url: imageUrl,
            image_load_ms: Number(loadElapsed.toFixed(1)),
        });
    };
    img.src = imageUrl;
};

// 积分：普通用户需要校验
const executeCost = computed(() => {
    const q = apiType.value === 'nano' && !quality.value ? '2K' : quality.value;
    return getCreditCost(apiType.value, 'generate', {
        quality: q || '2K',
        imageCount: numImages.value,
        model: nanoModel.value,
        providerHint: providerHint.value,
    });
});
const canExecuteCredits = computed(() => {
    return userStore.canAffordOperation(executeCost.value);
});
const executeButtonText = computed(() => {
    const base = isExecuted.value ? '再次执行' : '执行';
    if (userStore.userInfo?.role === 1) return base;
    return `${base} (消耗 ${executeCost.value} 积分)`;
});

// 统一的模型选择：dream 或 nano 子模型（nano-banana-2 / nano-banana-pro）
const initialSelectedModel = (() => {
    if (props.data?.apiType === 'midjourney') {
        return 'midjourney';
    }
    if (props.data?.apiType === 'nano') {
        const m = (props.data as any).model as string | undefined;
        if (m === 'gemini-3-pro-image-preview') return 'anyfast:gemini-3-pro-image-preview';
        if (m === 'gemini-3.1-flash-image-preview') return 'anyfast:gemini-3.1-flash-image-preview';
        if (m === 'nano-banana-pro') return 'nano:nano-banana-pro';
        if (m === 'nano-banana-2') return 'nano:nano-banana-2';
        // 默认走 AnyFast（若用户未显式选择）
        return 'anyfast:gemini-3.1-flash-image-preview';
    }
    return (props.data?.apiType || 'dream') as string;
})();
// 从节点数据初始化本地状态，保证从历史/模板加载时能恢复
const selectedModel = ref<string>(initialSelectedModel);
const quality = ref<string>((props.data as any)?.quality || '2K');
const aspectRatio = ref<string>((props.data as any)?.aspectRatio || '1:1'); // 使用比例字符串格式
const numImages = ref<number>(typeof (props.data as any)?.numImages === 'number' ? (props.data as any).numImages : 1);

// 计算属性：apiType 由 selectedModel 推导
const apiType = computed<'dream' | 'nano' | 'midjourney'>(() => {
    if (selectedModel.value === 'midjourney') return 'midjourney';
    return selectedModel.value.startsWith('nano:') || selectedModel.value.startsWith('anyfast:') ? 'nano' : 'dream';
});

// 计算属性：从 selectedModel 中提取具体的 nano 模型
const nanoModel = computed<'nano-banana-2' | 'nano-banana-pro' | 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview' | undefined>(() => {
    if (!selectedModel.value.startsWith('nano:') && !selectedModel.value.startsWith('anyfast:')) return undefined;
    const parts = selectedModel.value.split(':');
    return parts[1] as 'nano-banana-2' | 'nano-banana-pro' | 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
});

const providerHint = computed<'ace' | 'anyfast' | undefined>(() => {
    if (selectedModel.value.startsWith('anyfast:')) return 'anyfast';
    if (selectedModel.value.startsWith('nano:')) return 'ace';
    return undefined;
});

const isGemini3ProModel = computed(() => selectedModel.value === ANYFAST_PRO_MODEL);

// toast 去重，避免频繁提示
const lastToastKey = ref<string>('');
const toastOnce = (key: string, message: string) => {
    if (lastToastKey.value === key) return;
    lastToastKey.value = key;
    ElMessage.info(message);
};

watch(
    [isSuperAdmin, selectedModel],
    ([admin, model]) => {
        if (admin || model !== ANYFAST_PRO_MODEL) return;
        selectedModel.value = DEFAULT_ALLOWED_NANO_MODEL;
        toastOnce('anyfast-pro-forbidden', '普通用户不支持 NanoBanana Pro(anyfast)，已自动切换到 NanoBanana2(anyfast)');
    },
    { immediate: true }
);

// 可用的分辨率选项：Dream 含 standard，Nano Banana 系列为 1K/2K/4K
const availableResolutions = computed(() => {
    if (isGemini3ProModel.value) return ['4K'];
    if (apiType.value === 'dream') return ['1K', '2K', '4K', 'standard'];
    return ['1K', '2K', '4K'];
});

// 可用的比例选项（所有模型都支持相同的比例）
const availableAspectRatios = computed(() => {
    return ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
});

// 根据比例和分辨率计算像素尺寸（用于 Seedream）
const calculatePixelSize = (aspectRatioValue: string, resolutionValue: string): { width: number; height: number } => {
    // 分辨率映射
    const resolutionMap: Record<string, number> = {
        '1K': 1024,
        '2K': 2048,
        '4K': 4096,
        'standard': 2048 // 默认
    };
    
    const baseSize = resolutionMap[resolutionValue] || 2048;
    
    // 比例映射
    const ratioMap: Record<string, { width: number; height: number }> = {
        '1:1': { width: baseSize, height: baseSize },
        '2:3': { width: Math.floor(baseSize * 2/3), height: baseSize },
        '3:2': { width: baseSize, height: Math.floor(baseSize * 2/3) },
        '3:4': { width: Math.floor(baseSize * 3/4), height: baseSize },
        '4:3': { width: baseSize, height: Math.floor(baseSize * 3/4) },
        '4:5': { width: Math.floor(baseSize * 4/5), height: baseSize },
        '5:4': { width: baseSize, height: Math.floor(baseSize * 4/5) },
        '9:16': { width: Math.floor(baseSize * 9/16), height: baseSize },
        '16:9': { width: baseSize, height: Math.floor(baseSize * 9/16) },
        '21:9': { width: baseSize, height: Math.floor(baseSize * 9/21) }
    };
    
    return ratioMap[aspectRatioValue] || { width: baseSize, height: baseSize };
};

// 监听模型切换，重置不兼容的选项，并同步到节点数据
watch(selectedModel, (newModel) => {
    const isNano = newModel.startsWith('nano:') || newModel.startsWith('anyfast:');
    const isMidjourney = newModel === 'midjourney';
    if (newModel === ANYFAST_PRO_MODEL) {
        quality.value = '4K';
    } else if (isNano) {
        if (!quality.value || !['1K', '2K', '4K'].includes(quality.value)) {
            quality.value = '2K';
        }
    } else if (isMidjourney) {
        if (!quality.value || !['1K', '2K', '4K'].includes(quality.value)) {
            quality.value = '2K';
        }
    } else if (newModel === 'dream') {
        if (!quality.value || quality.value === '') {
            quality.value = '2K';
        }
    }
    // 同步 apiType / model 到节点数据，方便自动保存与恢复
    const api: 'dream' | 'nano' | 'midjourney' = isMidjourney ? 'midjourney' : (isNano ? 'nano' : 'dream');
    (props.data as any).apiType = api;
    (props.data as any).model = isNano ? newModel.split(':')[1] : (isMidjourney ? 'midjourney' : undefined);
    (props.data as any).providerHint = isNano ? providerHint.value : undefined;
}, { immediate: true });

// 将本地参数同步到节点数据，确保自动保存能带上这些配置
watch(quality, (val) => {
    (props.data as any).quality = val;
});
watch(aspectRatio, (val) => {
    (props.data as any).aspectRatio = val;
});
watch(numImages, (val) => {
    (props.data as any).numImages = val;
});

const loading = ref(false);
const imageUrl = ref(props.data?.imageUrl || '');
const imageUrls = ref<string[]>(props.data?.imageUrls || []); // 支持多图结果（用于传递给下游节点和创建 ImageNode）
const showFullscreenPreview = ref(false);
const previewImageUrl = ref('');
const isExecuted = ref(false); // 标记节点是否已执行

// 记录本次执行预创建的占位图片节点ID，用于结果回来后填充
const pendingImageNodeIds = ref<string[]>([]);

// 从连接读取的数据
const connectedPrompt = ref('');
const connectedImages = ref<string[]>([]);
const connectedImageAliases = ref<number[]>([]);
const connectedImageReadiness = ref({
    total: 0,
    ready: 0,
    loading: 0,
    error: 0,
    missingUrl: 0,
});

/**
 * 连入本节点的上游数据签名。
 * 使用 getNodes.value.find 而非 findNode：与 nodeLookup 相比，对 node.data 的写入能稳定触发 Vue 依赖收集，
 * 否则富文本仅 updateNodeData(text) 时 watch 可能不跑，connectedPrompt 一直为空（用户误以为「没提示词」）。
 */
const upstreamIntoDreamSig = computed(() => {
    const nodes = getNodes.value;
    const parts: string[] = [];
    for (const e of getEdges.value) {
        if (e.target !== props.id) continue;
        const n = nodes.find((x) => x.id === e.source);
        if (!n) {
            parts.push('');
            continue;
        }
        if (n.type === 'prompt') {
            parts.push(`p:${getPromptTextFromNodeData(n.data)}`);
        } else if (n.type === 'image') {
            const d = n.data as { imageUrl?: string; isLoading?: boolean; status?: string };
            parts.push(`i:${String(d?.imageUrl ?? '')}:${String(d?.isLoading)}:${String(d?.status ?? '')}`);
        } else {
            parts.push(n.type);
        }
    }
    return parts.join('\u0001');
});

function readConnectedPromptFromEdges(): string {
    const nodes = getNodes.value;
    let prompt = '';
    for (const e of getEdges.value) {
        if (e.target !== props.id) continue;
        const n = nodes.find((x) => x.id === e.source);
        if (n?.type !== 'prompt') continue;
        const t = getPromptTextFromNodeData(n.data);
        if (t.length > 0 && !prompt) prompt = t;
    }
    return prompt;
}

const imagesReady = computed(() => {
    const s = connectedImageReadiness.value;
    // 仅当有已统计的参考图时才校验就绪；避免 connectedImages 与 readiness 短暂不一致导致误禁用
    if (!s || s.total === 0) return true;
    return s.ready === s.total;
});

const canExecute = computed(() => {
    return canExecuteCredits.value && imagesReady.value;
});

/** 按钮禁用时悬停说明（与「有无提示词」无关；提示词在点击后再校验） */
const executeBlockedHint = computed(() => {
    if (canExecute.value) return '';
    if (!imagesReady.value) {
        const s = connectedImageReadiness.value;
        if ((s.loading || 0) > 0) return '参考图片仍在上传/生成中，请等待完成后再执行';
        if ((s.error || 0) > 0) return '上游参考图片生成失败，请更换后再执行';
        return '参考图片尚未就绪';
    }
    if (!userStore.token) return '请先登录后再执行';
    if (!canExecuteCredits.value) {
        const c = userStore.userInfo?.credits;
        if (typeof c === 'number' && Number.isFinite(c)) {
            return `积分不足：当前 ${c}，本次需 ${executeCost.value} 积分`;
        }
        return '积分未同步，请刷新页面或重新登录';
    }
    return '暂时无法执行';
});

// 计算连接状态
const connectedPromptCount = computed(() => {
    const edges = getEdges.value;
    const targetEdges = edges.filter(e => e.target === props.id);
    const promptEdges = targetEdges.filter(e => {
        const sourceNode = findNode(e.source);
        return sourceNode?.type === 'prompt';
    });
    return promptEdges.length;
});

const connectedImageCount = computed(() => {
    const edges = getEdges.value;
    const targetEdges = edges.filter(e => e.target === props.id);
    const imageEdges = targetEdges.filter(e => {
        const sourceNode = findNode(e.source);
        return sourceNode?.type === 'image';
    });
    return imageEdges.length;
});

// 监听连接变化，更新连接的数据（upstreamIntoDreamSig：就地改 text / 图片 url 时也要刷新）
watch(
    () => [getEdges.value, upstreamIntoDreamSig.value],
    () => {
        const edges = getEdges.value;
        const nodes = getNodes.value;
        const targetEdges = edges.filter(e => e.target === props.id);

        connectedPrompt.value = readConnectedPromptFromEdges();

        // 收集图片及其别名 + 就绪状态（isLoading/status）
        connectedImages.value = [];
        connectedImageAliases.value = [];
        const imageMeta: Array<ImageNodeLikeData> = [];
        targetEdges.forEach(edge => {
            const sourceNode = nodes.find((x) => x.id === edge.source);
            if (sourceNode && sourceNode.type === 'image' && sourceNode.data?.imageUrl) {
                const url = sourceNode.data.imageUrl;
                if (url && !connectedImages.value.includes(url)) {
                    connectedImages.value.push(url);
                    imageMeta.push({
                        imageUrl: (sourceNode.data as any)?.imageUrl,
                        isLoading: (sourceNode.data as any)?.isLoading,
                        status: (sourceNode.data as any)?.status,
                    });
                    const aliasText: string | undefined = (sourceNode.data as any)?.imageAlias;
                    let aliasNum: number | null = null;
                    if (typeof aliasText === 'string') {
                        const m = aliasText.match(/^图(\d+)$/);
                        if (m) {
                            const n = Number(m[1]);
                            if (!Number.isNaN(n) && n > 0) {
                                aliasNum = n;
                            }
                        }
                    }
                    // 若别名解析失败，则按当前长度顺序兜底
                    connectedImageAliases.value.push(aliasNum ?? connectedImageAliases.value.length + 1);
                }
            }
        });

        connectedImageReadiness.value = summarizeConnectedImages(imageMeta);
    },
    { immediate: true }
);

// 如果节点已有执行结果，标记为已执行（用于按钮文案“再次执行”）
if (props.data?.imageUrls && Array.isArray(props.data.imageUrls) && props.data.imageUrls.length > 0) {
    isExecuted.value = true;
}

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});

const tryRecoverFromGenerationKey = async (generationKey: string): Promise<'success' | 'failed' | 'pending' | 'not_found'> => {
    if (!generationKey) return 'not_found';
    try {
        const res: any = await getImageGenerateResultByGenerationKey(generationKey);
        const data = res?.data as any;
        const status = data?.status;
        const allImages: string[] = Array.isArray(data?.all_images) ? data.all_images : [];
        const syncStatus = typeof data?.sync_status === 'string' ? data.sync_status : 'pending';

        if (allImages.length > 0) {
            const fullUrls = allImages.map((url: string) => getUploadUrl(url));
            imageUrls.value = fullUrls;
            imageUrl.value = fullUrls[0] || '';
            props.data.imageUrl = allImages[0];
            props.data.imageUrls = allImages;
            isExecuted.value = true;

            const placeholderCountBeforeFill = pendingImageNodeIds.value.length;
            const filled = fillPlaceholderImageNodes(fullUrls, allImages);
            if (!filled && fullUrls.length > 0) {
                createImageNodes(fullUrls, allImages);
            } else {
                appendExtraImageNodesIfNeeded(fullUrls, allImages, placeholderCountBeforeFill);
            }
            markPendingPlaceholdersAsError();
            saveWorkflowImmediately();
            startCosSyncWatcher(generationKey, allImages, syncStatus);
            return 'success';
        }

        if (status === 2) return 'failed';
        if (status === 0 || status === 1) return 'pending';
        return 'not_found';
    } catch {
        return 'not_found';
    }
};

const sameStringArray = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

const applyLatestImagesToUi = (rawImages: string[]) => {
    if (!rawImages.length) return;
    const fullUrls = rawImages.map((url) => getUploadUrl(url));
    imageUrls.value = fullUrls;
    imageUrl.value = fullUrls[0] || '';
    props.data.imageUrl = rawImages[0];
    props.data.imageUrls = rawImages;

    setNodes(nodes => {
        const related = nodes
            .filter((n: any) => n?.type === 'image' && (n?.data as any)?.fromNodeId === props.id && !(n?.data as any)?.isLoading)
            .sort((a: any, b: any) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0));
        if (!related.length) return nodes;
        const idToIndex = new Map<string, number>();
        related.forEach((n: any, idx: number) => idToIndex.set(n.id, idx));
        return nodes.map((node: any) => {
            const idx = idToIndex.get(node.id);
            if (idx == null) return node;
            const raw = rawImages[idx] ?? rawImages[0] ?? '';
            if (!raw) return node;
            return {
                ...node,
                data: {
                    ...node.data,
                    imageUrl: getUploadUrl(raw),
                    originalImageUrl: raw,
                },
            };
        });
    });
    saveWorkflowImmediately();
};

const cosSyncWatcherMap = new Map<string, ReturnType<typeof setInterval>>();

const stopCosSyncWatcher = (generationKey: string) => {
    const timer = cosSyncWatcherMap.get(generationKey);
    if (timer) {
        clearInterval(timer);
        cosSyncWatcherMap.delete(generationKey);
    }
};

const startCosSyncWatcher = (generationKey: string, initialRawImages: string[], initialSyncStatus?: string) => {
    if (!generationKey || !initialRawImages.length) return;
    if (initialSyncStatus === 'synced') return;
    if (cosSyncWatcherMap.has(generationKey)) return;

    let lastRawImages = [...initialRawImages];
    let attempts = 0;
    const maxAttempts = 36; // 最长约 3 分钟（5 秒一次）
    const timer = setInterval(async () => {
        attempts += 1;
        if (attempts > maxAttempts) {
            stopCosSyncWatcher(generationKey);
            return;
        }
        try {
            const res: any = await getImageGenerateResultByGenerationKey(generationKey);
            const data = res?.data as any;
            const latestRawImages: string[] = Array.isArray(data?.all_images) ? data.all_images : [];
            if (!latestRawImages.length) return;

            const syncStatus = typeof data?.sync_status === 'string' ? data.sync_status : 'pending';
            if (!sameStringArray(lastRawImages, latestRawImages)) {
                applyLatestImagesToUi(latestRawImages);
                console.log('[DreamNode][Timing] url_switched_to_cos', {
                    trace_id: generationKey,
                    sync_status: syncStatus,
                });
                lastRawImages = [...latestRawImages];
            }
            if (syncStatus === 'synced' || syncStatus === 'failed') {
                stopCosSyncWatcher(generationKey);
            }
        } catch {
            // 忽略本轮错误，继续下一轮
        }
    }, 5000);

    cosSyncWatcherMap.set(generationKey, timer);
};



// 生成图片
const handleGenerate = async () => {
    if (!canExecute.value) {
        // 优先提示“图片未就绪”，其次才是积分不足
        if (!imagesReady.value) {
            const s = connectedImageReadiness.value;
            if ((s.loading || 0) > 0) {
                ElMessage.warning('参考图片仍在上传/生成中，请等待完成后再生成');
            } else if ((s.error || 0) > 0) {
                ElMessage.warning('上游参考图片生成失败，请更换或重新生成后再试');
            } else {
                ElMessage.warning('参考图片尚未就绪，请稍后再试');
            }
            return;
        }
        ElMessage.warning('积分不足，请向超级管理员申请');
        return;
    }

    // 兜底：按钮禁用态可能因异步刷新滞后，点击时再次阻断
    if (!imagesReady.value) {
        const s = connectedImageReadiness.value;
        if ((s.loading || 0) > 0) {
            ElMessage.warning('参考图片仍在上传/生成中，请等待完成后再生成');
        } else if ((s.error || 0) > 0) {
            ElMessage.warning('上游参考图片生成失败，请更换或重新生成后再试');
        } else {
            ElMessage.warning('参考图片尚未就绪，请稍后再试');
        }
        return;
    }
    loading.value = true;
    let generationKey = '';
    const requestStartMs = performance.now();
    try {
        // 1. 从连接读取数据（执行前再读一次，防止 watch 未触发的边界情况）
        const finalPrompt = readConnectedPromptFromEdges();
        connectedPrompt.value = finalPrompt;
        const referenceImageUrls = [...connectedImages.value];
        const referenceImageAliases = [...connectedImageAliases.value];

        // 2. 校验：至少需要提示词或图片之一
        // 约束：必须至少连接一个提示词节点才能执行
        if (!finalPrompt) {
            ElMessage.warning('请先连接一个提示词节点');
            loading.value = false;
            return;
        }

        console.log(`🔗 使用连接的数据:`, {
            prompt: finalPrompt,
            images: referenceImageUrls.length
        });

        // 3. 根据模型和选择计算尺寸（用于 Seedream）
        let width = 2048;
        let height = 2048;
        if (apiType.value === 'dream') {
            const pixelSize = calculatePixelSize(aspectRatio.value, quality.value);
            width = pixelSize.width;
            height = pixelSize.height;
        }

        // 4. 处理参考图片：转换URL格式
        const hasMultipleReferenceImages = referenceImageUrls.length > 1;
        let referenceImageUrl = '';
        
        // 转换图片URL为完整URL
        const processedImageUrls = referenceImageUrls.map(url => getUploadUrl(url));
                    
        if (processedImageUrls.length === 1 && processedImageUrls[0]) {
            referenceImageUrl = processedImageUrls[0];
        }

        // 5. 构建请求参数
        const requestParams: any = {
            apiType: apiType.value,
            prompt: finalPrompt || '基于参考图片生成',
            numImages: numImages.value,
            imageUrl: hasMultipleReferenceImages ? undefined : (referenceImageUrl || undefined),
            imageUrls: hasMultipleReferenceImages && processedImageUrls.length > 0 ? processedImageUrls : undefined,
        };

        // 为 Nano 传递与图片一一对应的别名编号（例如 4 表示“图4”）
        if (processedImageUrls.length > 0 && referenceImageAliases.length > 0) {
            const imageAliases = referenceImageAliases.slice(0, processedImageUrls.length);
            if (imageAliases.some(n => typeof n === 'number' && n > 0)) {
                requestParams.imageAliases = imageAliases;
            }
        }

        // 6. 根据模型类型处理参数
        if (apiType.value === 'dream') {
            // Seedream: 将尺寸信息添加到提示词，并传递 width/height
            const sizeInfo = `${aspectRatio.value}比例、${quality.value === 'standard' ? '标准' : quality.value}分辨率的图片，尺寸为${width}x${height}像素`;
            
            // 检查提示词中是否已包含尺寸信息，避免重复添加
            const hasSizeInfo = requestParams.prompt.includes('比例') || requestParams.prompt.includes('分辨率') || requestParams.prompt.includes('像素');
            if (!hasSizeInfo) {
                requestParams.prompt = `${requestParams.prompt || '生成图片'}，生成一个${sizeInfo}`;
            }
            
            // 传递像素尺寸
            requestParams.width = width;
            requestParams.height = height;
            
            // 传递 quality（用于 Seedream 的尺寸模式）
            if (quality.value !== 'standard') {
                requestParams.quality = quality.value;
            }
            
            console.log(`[前端] Seedream 模式: ${width}x${height}, 比例: ${aspectRatio.value}, 分辨率: ${quality.value}`);
        } else if (apiType.value === 'nano') {
            // Nano Banana 2 / Nano Banana Pro (Ace Data Cloud)
            requestParams.aspectRatio = aspectRatio.value;
            if (isGemini3ProModel.value) quality.value = '4K';
            if (quality.value) requestParams.quality = quality.value;
            if (nanoModel.value) requestParams.model = nanoModel.value;
            if (providerHint.value) requestParams.providerHint = providerHint.value;
            console.log(`[前端] Nano/AnyFast 模型=${nanoModel.value || 'nano-banana-2'}, 供应商=${providerHint.value || 'ace'}, 比例=${aspectRatio.value}, 分辨率=${quality.value || '2K'}`);
        } else if (apiType.value === 'midjourney') {
            requestParams.mode = 'fast';
            requestParams.translation = true;
            requestParams.timeout = 120;
            requestParams.splitImages = true;
            requestParams.mjAction = 'generate';
            requestParams.model = 'midjourney';
            requestParams.aspectRatio = aspectRatio.value;
            if (quality.value) requestParams.quality = quality.value;
            console.log(`[前端] Midjourney 模式: mode=fast, translation=true, splitImages=true, 比例=${aspectRatio.value}, 分辨率=${quality.value}`);
        }
        
        console.log('发送生图请求，参数:', requestParams);

        // 在发送请求前，根据生成数量预创建占位图片节点（loading 状态）
        // 并为本次生成生成一个幂等 generationKey，刷新/历史恢复后可用该 key 查询最终结果。
        generationKey = `imggen_${String(props.id)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        requestParams.generationKey = generationKey;
        logFrontendE2ETiming('request_started', generationKey, requestStartMs, {
            node_id: String(props.id),
            api_type: apiType.value,
            expected_images: numImages.value || 1,
        });
        const tid = workflowTemplateId?.value;
        if (tid != null && tid > 0) {
            requestParams.templateId = tid;
        }

        const expectedCount = numImages.value || 1;
        createPlaceholderImageNodes(expectedCount, generationKey);

        const res: any = await generateImage(requestParams);
        console.log("[DreamNode][Timing] 接口返回", {
            trace_id: generationKey || "unknown",
            api_elapsed_ms: Number((performance.now() - requestStartMs).toFixed(1)),
            has_data: !!res?.data,
        });
        logFrontendE2ETiming('response_received', generationKey || "unknown", requestStartMs, {
            has_data: !!res?.data,
        });
        
        console.log('👉 后端原始返回:', res);
        // 后端返回格式: { message: "任务提交成功", data: { image_url: "...", all_images: [...] } }
        if (res.data) {
            // 处理多图结果
            const allImages = res.data.all_images || (res.data.image_url ? [res.data.image_url] : []);
            const syncStatus = typeof res.data.sync_status === 'string' ? res.data.sync_status : 'pending';
            
            if (allImages.length > 0) {
                // 转换所有图片URL为完整URL
                const fullUrls = allImages.map((url: string) => getUploadUrl(url));
                
                imageUrls.value = fullUrls;
                imageUrl.value = fullUrls[0]; // 第一张作为主图
                if (fullUrls[0]) {
                    logFirstImageLoadTiming(fullUrls[0], generationKey || "unknown", requestStartMs);
                }
                
                // 更新节点数据，供下游节点使用
                props.data.imageUrl = res.data.image_url || allImages[0];
                props.data.imageUrls = allImages;
                
                console.log(`👉 成功生成 ${fullUrls.length} 张图片:`, fullUrls);
                ElMessage.success(`成功生成 ${fullUrls.length} 张图片！`);
                creditTracker?.addSpent?.(executeCost.value);
                userStore.fetchCredits();
                
                // 标记节点为已执行（下次显示“再次执行”）
                isExecuted.value = true;
                
                // 用真实图片填充占位节点；若返回数量超过占位数量，补建额外节点。
                const placeholderCountBeforeFill = pendingImageNodeIds.value.length;
                if (!fillPlaceholderImageNodes(fullUrls, allImages) && fullUrls.length > 0 && currentNode.value) {
                    createImageNodes(fullUrls, allImages);
                } else {
                    appendExtraImageNodesIfNeeded(fullUrls, allImages, placeholderCountBeforeFill);
                }
                // 若存在“部分成功”，将未回填占位落为失败态，避免节点一直显示生成中
                const failedCount = markPendingPlaceholdersAsError();
                if (failedCount > 0) {
                    ElMessage.warning(`部分生成失败，仅成功 ${fullUrls.length} 张，失败 ${failedCount} 张`);
                }

                void notifyMediaGeneration({
                    kind: 'image',
                    success: true,
                    nodeId: String(props.id),
                    message:
                        failedCount > 0
                            ? `已生成 ${fullUrls.length} 张图片，另有 ${failedCount} 张失败。`
                            : `已成功生成 ${fullUrls.length} 张图片。`
                });

                saveWorkflowImmediately();
                logFrontendE2ETiming('ui_data_bound', generationKey || "unknown", requestStartMs, {
                    returned_images: fullUrls.length,
                    failed_placeholders: failedCount,
                });
                startCosSyncWatcher(generationKey, allImages, syncStatus);
            } else if (res.data.image_url) {
                // 兼容旧格式：只有 image_url
                const url = res.data.image_url.startsWith('http')
                    ? res.data.image_url
                    : getUploadUrl(res.data.image_url);
                imageUrl.value = url;
                imageUrls.value = [url];
                logFirstImageLoadTiming(url, generationKey || "unknown", requestStartMs);
                props.data.imageUrl = res.data.image_url;
                console.log('👉 完整图片URL:', url);
                ElMessage.success('图片生成成功！');
                creditTracker?.addSpent?.(executeCost.value);
                userStore.fetchCredits();
                
                // 标记节点为已执行（下次显示“再次执行”）
                isExecuted.value = true;
                
                // 单张图同样优先填充占位节点
                if (!fillPlaceholderImageNodes([url], [res.data.image_url]) && currentNode.value) {
                    createImageNodes([url], [res.data.image_url]);
                }
                const failedCount = markPendingPlaceholdersAsError();
                if (failedCount > 0) {
                    ElMessage.warning(`部分生成失败，仅成功 1 张，失败 ${failedCount} 张`);
                }

                void notifyMediaGeneration({
                    kind: 'image',
                    success: true,
                    nodeId: String(props.id),
                    message:
                        failedCount > 0
                            ? `已生成 1 张图片，另有 ${failedCount} 张失败。`
                            : '已成功生成 1 张图片。'
                });

                saveWorkflowImmediately();
                logFrontendE2ETiming('ui_data_bound', generationKey || "unknown", requestStartMs, {
                    returned_images: 1,
                    failed_placeholders: failedCount,
                });
                startCosSyncWatcher(generationKey, [res.data.image_url], syncStatus);
            } else {
                console.warn('后端返回数据:', res.data);
                markPendingPlaceholdersAsError();
                ElMessage.warning('生成成功，但未获取到图片URL');
                void notifyMediaGeneration({
                    kind: 'image',
                    success: false,
                    nodeId: String(props.id),
                    message: '生成成功，但未获取到图片 URL'
                });
            }
        } else {
            console.warn('后端返回格式异常:', res);
            markPendingPlaceholdersAsError();
            ElMessage.warning('生成成功，但未获取到图片URL');
            void notifyMediaGeneration({
                kind: 'image',
                success: false,
                nodeId: String(props.id),
                message: '返回数据异常，未获取到图片 URL'
            });
        }
    } catch (error) {
        console.error('[DreamNode] 图片生成失败', error);

        const recoverState = await tryRecoverFromGenerationKey(generationKey);
        if (recoverState === 'success') {
            ElMessage.success('图片已生成成功，已自动同步结果');
            void notifyMediaGeneration({
                kind: 'image',
                success: true,
                nodeId: String(props.id),
                message: '请求异常后已从生成记录恢复成功'
            });
            return;
        }
        if (recoverState === 'failed') {
            // 只有后端明确失败时才将占位节点落为失败态，避免“已成功但前端先报错”的误判。
            markPendingPlaceholdersAsError();
        }

        const errMsg =
            (error as Error)?.message ||
            (typeof error === 'string' ? error : '') ||
            '图片生成失败，请稍后重试';
        if (recoverState === 'pending' || recoverState === 'not_found') {
            ElMessage.warning('请求异常，正在后台同步生成结果，请稍后查看');
            saveWorkflowImmediately();
            return;
        }
        void notifyMediaGeneration({
            kind: 'image',
            success: false,
            nodeId: String(props.id),
            message: errMsg
        });
        ElMessage.error(errMsg || '图片生成失败，请稍后重试');
        saveWorkflowImmediately();
    } finally {
        loading.value = false;
    }
};


// 为每张生成的图片创建新的 ImageNode 节点
const createImageNodes = (fullUrls: string[], originalUrls: string[]) => {
    if (!currentNode.value) {
        console.warn('无法获取当前节点信息，跳过创建图片节点');
        return;
    }

    const nodeWidth = currentNode.value.dimensions?.width || 480;
    const startX = currentNode.value.position.x + nodeWidth + 80;
    const startY = currentNode.value.position.y;
    
    // 根据图片数量动态调整节点尺寸和间距
    const isMultipleImages = fullUrls.length > 1;
    const nodeSpacing = isMultipleImages ? 180 : 280; // 多图时缩小间距

    fullUrls.forEach((fullUrl, index) => {
        const nodeId = `image_node_${Date.now()}_${index}`;
        const edgeId = `edge_${Date.now()}_${index}`;

        // 计算新节点位置（垂直排列）
        const newNodePosition = {
            x: startX,
            y: startY + index * nodeSpacing
        };
        
        // 为多图节点添加标记，用于缩小尺寸
        const nodeData: any = {
            imageUrl: fullUrl,
            prompt: readConnectedPromptFromEdges() || '',
            originalImageUrl: originalUrls[index],
            fromNodeId: props.id, // 记录来源生图节点，方便在 ImageNode 中自动补连线
        };
        
        if (isMultipleImages) {
            nodeData.isCompact = true; // 标记为紧凑模式
        }

        // 创建图片节点
        addNodes({
            id: nodeId,
            type: 'image',
            position: newNodePosition,
            data: nodeData
        });

        // 创建从当前节点到图片节点的连接
        addEdges({
            id: edgeId,
            source: props.id,
            target: nodeId,
            sourceHandle: 'source',
            targetHandle: 'target'
        });
    });

    console.log(`✅ 已为 ${fullUrls.length} 张图片创建独立节点`);
    saveWorkflowImmediately();
};

// 预创建占位图片节点（仅有 loading 骨架，无实际图片）
const createPlaceholderImageNodes = (count: number, generationKey: string) => {
    if (!currentNode.value) {
        console.warn('无法获取当前节点信息，跳过创建占位图片节点');
        return;
    }

    const nodeWidth = currentNode.value.dimensions?.width || 480;
    const startX = currentNode.value.position.x + nodeWidth + 80;
    const startY = currentNode.value.position.y;
    const nodeSpacing = count > 1 ? 180 : 280;

    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
        const nodeId = `image_placeholder_${Date.now()}_${i}`;
        const edgeId = `edge_placeholder_${Date.now()}_${i}`;

        const newNodePosition = {
            x: startX,
            y: startY + i * nodeSpacing,
        };

        ids.push(nodeId);

        addNodes({
            id: nodeId,
            type: 'image',
            position: newNodePosition,
            data: {
                imageUrl: '',
                isLoading: true,
                fromNodeId: props.id, // 记录来源生图节点
                generationKey,
                index: i,
            },
        });

        addEdges({
            id: edgeId,
            source: props.id,
            target: nodeId,
            sourceHandle: 'source',
            targetHandle: 'target',
        });
    }

    pendingImageNodeIds.value = ids;
    console.log(`✅ 已预创建 ${ids.length} 个占位图片节点`, ids);
    saveWorkflowImmediately();
};

let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight = false;

const reconcilePendingImagePlaceholders = async () => {
    if (reconcileInFlight) return;
    reconcileInFlight = true;

    try {
        // 收集所有“未完成占位节点”
        const placeholderNodes = getNodes.value.filter((n: any) => {
            const d = n?.data;
            return n?.type === 'image' && d?.fromNodeId === props.id && d?.isLoading === true && typeof d?.generationKey === 'string' && d.generationKey.trim().length > 0;
        });

        if (!placeholderNodes.length) {
            if (reconcileInterval) {
                clearInterval(reconcileInterval);
                reconcileInterval = null;
            }
            return;
        }

        // 按 generationKey 分组（一次生成会创建一组占位节点）
        const groupMap = new Map<string, Array<{ id: string; index: number; y: number }>>();
        for (const node of placeholderNodes) {
            const d = node.data as any;
            const key = d.generationKey as string;
            const idx = typeof d.index === 'number' ? d.index : Number(node.position?.y ?? 0);
            const y = Number(node.position?.y ?? 0);
            const arr = groupMap.get(key) ?? [];
            arr.push({ id: node.id, index: idx, y });
            groupMap.set(key, arr);
        }

        // 逐个拉取，避免一次并发过多
        for (const [generationKey, items] of groupMap.entries()) {
            const ordered = items.slice().sort((a, b) => a.index - b.index);
            const ids = ordered.map((it) => it.id);

            let res: any;
            try {
                res = await getImageGenerateResultByGenerationKey(generationKey);
            } catch (e: any) {
                // 404：可能是后端尚未创建记录；继续等下一轮
                const status = e?.response?.status;
                if (status === 404) continue;
                // 其它错误：继续等待，避免误把仍在生成的任务标成失败
                continue;
            }

            // request 拦截器已把 axios response.data 直接返回给前端：
            // 后端响应结构为 { message, data }，所以这里应取 res.data
            const data = res?.data as any;
            const status = data?.status;
            const allImages: string[] = Array.isArray(data?.all_images) ? data.all_images : [];
            const syncStatus = typeof data?.sync_status === 'string' ? data.sync_status : 'pending';

            // 优先以“是否已经拿到图片URL”为准：只要有结果就回填成功，
            // 不必纠结 status=0/1 的语义（避免“猜测还没完成”的体验问题）。
            if (allImages.length > 0) {
                const fullUrls = allImages.map((url: string) => getUploadUrl(url));
                imageUrls.value = fullUrls;
                imageUrl.value = fullUrls[0] || '';
                props.data.imageUrl = allImages[0];
                props.data.imageUrls = allImages;
                isExecuted.value = true;

                pendingImageNodeIds.value = ids;
                const placeholderCountBeforeFill = pendingImageNodeIds.value.length;
                const filled = fillPlaceholderImageNodes(fullUrls, allImages);
                if (!filled && fullUrls.length > 0) {
                    createImageNodes(fullUrls, allImages);
                } else {
                    appendExtraImageNodesIfNeeded(fullUrls, allImages, placeholderCountBeforeFill);
                }

                markPendingPlaceholdersAsError();
                startCosSyncWatcher(generationKey, allImages, syncStatus);
                continue;
            }

            if (status === 1) {
                if (!allImages.length) {
                    // 状态成功但没有图片，按失败兜底避免一直 loading
                    pendingImageNodeIds.value = ids;
                    markPendingPlaceholdersAsError();
                    continue;
                }

                const fullUrls = allImages.map((url: string) => getUploadUrl(url));
                imageUrls.value = fullUrls;
                imageUrl.value = fullUrls[0] || '';
                props.data.imageUrl = allImages[0];
                props.data.imageUrls = allImages;
                isExecuted.value = true;

                pendingImageNodeIds.value = ids;
                const placeholderCountBeforeFill = pendingImageNodeIds.value.length;
                const filled = fillPlaceholderImageNodes(fullUrls, allImages);
                if (!filled && fullUrls.length > 0) {
                    createImageNodes(fullUrls, allImages);
                } else {
                    appendExtraImageNodesIfNeeded(fullUrls, allImages, placeholderCountBeforeFill);
                }

                markPendingPlaceholdersAsError();
                continue;
            }

            // status === 2：失败态（后端明确写入）
            if (status === 2) {
                pendingImageNodeIds.value = ids;
                markPendingPlaceholdersAsError();
            }
            // status === 0：pending（不做任何事，继续等待下一轮轮询）
        }
    } finally {
        reconcileInFlight = false;
    }
};

onMounted(() => {
    // 首次拉取稍微延迟，确保 getNodes() 已完成恢复
    setTimeout(() => {
        if (reconcileInterval) return;
        reconcileInterval = setInterval(() => {
            void reconcilePendingImagePlaceholders();
        }, 5000);
        void reconcilePendingImagePlaceholders();
    }, 300);
});

onUnmounted(() => {
    if (reconcileInterval) clearInterval(reconcileInterval);
    reconcileInterval = null;
    for (const key of cosSyncWatcherMap.keys()) {
        stopCosSyncWatcher(key);
    }
});

// 将仍处于 pending 的占位节点统一落为失败态，避免长期“生成中”
const markPendingPlaceholdersAsError = (): number => {
    const failedIds = [...pendingImageNodeIds.value];
    if (!failedIds.length) return 0;

    setNodes(nodes =>
        nodes.map(node =>
            failedIds.includes(node.id)
                ? {
                    ...node,
                    data: {
                        ...node.data,
                        isLoading: false,
                        status: 'error',
                    },
                }
                : node
        )
    );

    pendingImageNodeIds.value = [];
    saveWorkflowImmediately();
    return failedIds.length;
};

// 将真实结果填充到占位图片节点；若没有占位返回 false
const fillPlaceholderImageNodes = (fullUrls: string[], originalUrls: string[]): boolean => {
    const ids = pendingImageNodeIds.value;
    if (!ids.length) return false;

    const fillCount = Math.min(ids.length, fullUrls.length, originalUrls.length);
    const filledIdSet = new Set(ids.slice(0, fillCount));

    setNodes(nodes =>
        nodes.map(node => {
            const idx = ids.indexOf(node.id);
            if (idx === -1 || idx >= fillCount) return node;

            return {
                ...node,
                data: {
                    ...node.data,
                    imageUrl: fullUrls[idx],
                    originalImageUrl: originalUrls[idx],
                    isLoading: false,
                },
            };
        })
    );

    // 仅移除已回填成功的占位；剩余占位交由调用方决定是否落失败态
    pendingImageNodeIds.value = ids.filter(id => !filledIdSet.has(id));
    saveWorkflowImmediately();
    return fillCount > 0;
};

// 返回图片数量超过占位节点时，补建剩余图片节点，避免仅显示前几张。
const appendExtraImageNodesIfNeeded = (fullUrls: string[], originalUrls: string[], filledPlaceholderCount: number) => {
    if (!currentNode.value) return;
    if (fullUrls.length <= filledPlaceholderCount) return;
    const extraFullUrls = fullUrls.slice(filledPlaceholderCount);
    const extraOriginalUrls = originalUrls.slice(filledPlaceholderCount);
    if (!extraFullUrls.length) return;
    createImageNodes(extraFullUrls, extraOriginalUrls);
};

const workflowPersistence = inject<WorkflowPersistenceStore | null>('workflowPersistence', null);
const hasInlineDataUrl = (val: unknown): boolean => typeof val === 'string' && val.startsWith('data:image/');
const shouldSkipWorkflowSaveForLargePayload = (): boolean => {
    if (hasInlineDataUrl((props.data as any)?.imageUrl)) return true;
    if (Array.isArray((props.data as any)?.imageUrls) && (props.data as any).imageUrls.some((x: unknown) => hasInlineDataUrl(x))) {
        return true;
    }
    // 仅检查当前生图节点产出的图片节点，避免被其它节点（如上传预览）误伤导致一直无法保存
    return getNodes.value.some((n: any) => {
        if (n?.type !== 'image') return false;
        const nodeData = (n?.data as any) || {};
        if (nodeData?.fromNodeId !== props.id) return false;
        return hasInlineDataUrl(nodeData?.imageUrl) || hasInlineDataUrl(nodeData?.originalImageUrl);
    });
};
const saveWorkflowImmediately = () => {
    if (shouldSkipWorkflowSaveForLargePayload()) {
        console.warn('[DreamNode] 跳过自动保存：检测到 data URL，等待同步为短链接后再保存');
        return;
    }
    if (workflowPersistence && typeof workflowPersistence.saveImmediately === 'function') {
        try {
            workflowPersistence.saveImmediately();
        } catch (e) {
            console.error('[DreamNode] 保存工作流失败:', e);
        }
    }
};
</script>

<style scoped>
.dream-node .nodrag {
    cursor: auto;
}

.dream-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 280px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
    overflow: visible;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
}

/* 默认隐藏所有 handle，hover 时显示 */
.dream-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.dream-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

.node-header {
    background: #3a3a3f;
    color: #e0e0e0;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    border-bottom: 1px solid #404040;
    border-radius: 30px 30px 0 0;
}

.node-content {
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    color: #e0e0e0;
}

.params-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 8px;
}

.arrow-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: #f5f5f5;
    border-radius: 2px;
    color: #666;
    font-size: 12px;
    font-weight: normal;
}


/* 参数设置区域 */
.params-section {
    width: 100%;
}

.param-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2px 0;
}

.param-label {
    font-size: 12px;
    color: #b0b0b0;
    flex: 0 0 auto;
    min-width: 72px;
}

.param-select {
    width: 132px;
    margin-bottom: 0;
}

.param-select :deep(.el-input__wrapper) {
    background: #252525;
    border-radius: 8px;
    box-shadow: none;
    border: 1px solid #404040;
}

.param-select :deep(.el-select__wrapper) {
    background-color: #252525;
    border-radius: 8px;
    box-shadow: none;
    border: 1px solid #404040;
}

.dream-node :deep(.el-input__inner),
.dream-node :deep(.el-select__placeholder) {
    color: #b0b0b0;
}

.dream-node :deep(.el-input__inner::placeholder) {
    color: #808080;
}

.param-select :deep(.el-input__wrapper:hover) {
    border-color: #409eff;
}

.param-select :deep(.el-input__wrapper.is-focus) {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.model-select {
    max-width: 100%;
}

.param-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #909399;
    margin-top: 4px;
    padding: 4px 8px;
    background: #f5f7fa;
    border-radius: 4px;
    line-height: 1.3;
}

.param-hint .el-icon {
    font-size: 12px;
    color: #409eff;
}

.execute-btn-tooltip-anchor {
    display: block;
    width: 100%;
    margin-top: 8px;
}

.execute-btn {
    width: 100%;
}

.executed-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    margin-top: 8px;
    color: #67c23a;
    font-size: 13px;
    font-weight: 500;
    background: #f0f9ff;
    border-radius: 4px;
}

.executed-status .el-icon {
    font-size: 16px;
}

/* 全屏预览样式 */
.fullscreen-preview-dialog {
    margin: 0 !important;
    padding: 0 !important;
}

.fullscreen-preview-dialog :deep(.el-dialog) {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    margin: 0 !important;
    padding: 0 !important;
    background: rgba(0, 0, 0, 0.95) !important;
    border-radius: 0 !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 10000 !important;
}

.fullscreen-preview-dialog :deep(.el-dialog__header) {
    padding: 0 !important;
    margin: 0 !important;
    height: 0 !important;
    overflow: hidden;
}

.fullscreen-preview-dialog :deep(.el-dialog__body) {
    padding: 0 !important;
    margin: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
}

.fullscreen-preview-dialog :deep(.el-overlay) {
    background-color: rgba(0, 0, 0, 0.95) !important;
    z-index: 9999 !important;
}

.preview-header {
    display: none;
}

.fullscreen-preview-container {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer;
    position: relative;
    overflow: hidden !important;
}

.fullscreen-image {
    max-width: 95vw !important;
    max-height: 95vh !important;
    object-fit: contain !important;
    cursor: zoom-out;
    user-select: none;
}


</style>