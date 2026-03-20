<template>
    <div class="dream-node">
        <!-- 顶部标题（与参考图一致） -->
        <div class="node-header">
            <span>模型参数</span>
        </div>
        <!-- 内容区域 -->
        <div class="node-content">
            <!-- 右侧：参数设置 -->
            <div class="params-section">
                
                <!-- 模型选择 -->
                <div class="param-item">
                    <div class="param-label">模型</div>
                    <el-select v-model="selectedModel" placeholder="选择模型" size="small" class="param-select model-select">
                        <el-option label="Seedream" value="dream" />
                        <el-option label="Nano Banana 2" value="nano:nano-banana-2" />
                        <el-option label="Nano Banana Pro" value="nano:nano-banana-pro" />
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
                        :disabled="!availableResolutions.length"
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

                <!-- 执行按钮 -->
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
import { ref, computed, watch, onMounted, onUnmounted, inject } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Picture, InfoFilled, CircleCheck } from '@element-plus/icons-vue';
import { generateImage } from '../../api/image';
import { uploadImage } from '../../api/upload';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import { getCreditCost } from '@/utils/credits';
import { getUploadUrl } from '@/utils/image-loader';
import { notifyMediaGeneration } from '@/utils/browser-notification';

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

// 积分：普通用户需要校验
const executeCost = computed(() => {
    const q = apiType.value === 'nano' && !quality.value ? '2K' : quality.value;
    return getCreditCost(apiType.value, 'generate', { quality: q || '2K', imageCount: numImages.value });
});
const canExecute = computed(() => {
    if (userStore.userInfo?.role === 1) return true;
    return (userStore.userInfo?.credits ?? 0) >= executeCost.value;
});
const executeButtonText = computed(() => {
    const base = isExecuted.value ? '再次执行' : '执行';
    if (userStore.userInfo?.role === 1) return base;
    return `${base} (消耗 ${executeCost.value} 积分)`;
});

// 统一的模型选择：dream 或 nano 子模型（nano-banana-2 / nano-banana-pro）
const initialSelectedModel = (() => {
    if (props.data?.apiType === 'nano') {
        const m = (props.data as any).model as string | undefined;
        if (m === 'nano-banana-pro') return 'nano:nano-banana-pro';
        if (m === 'nano-banana-2') return 'nano:nano-banana-2';
        // 默认使用 nano-banana-2
        return 'nano:nano-banana-2';
    }
    return (props.data?.apiType || 'dream') as string;
})();
// 从节点数据初始化本地状态，保证从历史/模板加载时能恢复
const selectedModel = ref<string>(initialSelectedModel);
const quality = ref<string>((props.data as any)?.quality || '2K');
const aspectRatio = ref<string>((props.data as any)?.aspectRatio || '1:1'); // 使用比例字符串格式
const numImages = ref<number>(typeof (props.data as any)?.numImages === 'number' ? (props.data as any).numImages : 1);

// 计算属性：apiType 由 selectedModel 推导
const apiType = computed<'dream' | 'nano'>(() => {
    return selectedModel.value.startsWith('nano:') ? 'nano' : 'dream';
});

// 计算属性：从 selectedModel 中提取具体的 nano 模型
const nanoModel = computed<'nano-banana-2' | 'nano-banana-pro' | undefined>(() => {
    if (!selectedModel.value.startsWith('nano:')) return undefined;
    const parts = selectedModel.value.split(':');
    return parts[1] as 'nano-banana-2' | 'nano-banana-pro';
});

// toast 去重，避免频繁提示
const lastToastKey = ref<string>('');
const toastOnce = (key: string, message: string) => {
    if (lastToastKey.value === key) return;
    lastToastKey.value = key;
    ElMessage.info(message);
};

// 可用的分辨率选项：Dream 含 standard，Nano Banana 系列为 1K/2K/4K
const availableResolutions = computed(() => {
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
    const isNano = newModel.startsWith('nano:');
    if (isNano) {
        if (!quality.value || !['1K', '2K', '4K'].includes(quality.value)) {
            quality.value = '2K';
        }
    } else if (newModel === 'dream') {
        if (!quality.value || quality.value === '') {
            quality.value = '2K';
        }
    }
    // 同步 apiType / model 到节点数据，方便自动保存与恢复
    const api: 'dream' | 'nano' = isNano ? 'nano' : 'dream';
    (props.data as any).apiType = api;
    (props.data as any).model = isNano ? newModel.split(':')[1] : undefined;
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

// 监听连接变化，更新连接的数据
watch(
    () => [getEdges.value, getNodes.value],
    () => {
        const edges = getEdges.value;
        const targetEdges = edges.filter(e => e.target === props.id);
        
        // 收集提示词
        connectedPrompt.value = '';
        targetEdges.forEach(edge => {
            const sourceNode = findNode(edge.source);
            if (sourceNode && sourceNode.type === 'prompt' && sourceNode.data?.text) {
                // 取第一个提示词节点
                if (!connectedPrompt.value) connectedPrompt.value = sourceNode.data.text;
    }
        });

        // 收集图片及其别名
        connectedImages.value = [];
        connectedImageAliases.value = [];
        targetEdges.forEach(edge => {
            const sourceNode = findNode(edge.source);
            if (sourceNode && sourceNode.type === 'image' && sourceNode.data?.imageUrl) {
                const url = sourceNode.data.imageUrl;
                if (url && !connectedImages.value.includes(url)) {
                    connectedImages.value.push(url);
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
    },
    { immediate: true, deep: true }
);

// 如果节点已有执行结果，标记为已执行（用于按钮文案“再次执行”）
if (props.data?.imageUrls && Array.isArray(props.data.imageUrls) && props.data.imageUrls.length > 0) {
    isExecuted.value = true;
}

// 计算当前节点位置
const currentNode = computed(() => {
    return getNodes.value.find(n => n.id === props.id);
});



// 生成图片
const handleGenerate = async () => {
    if (!canExecute.value) {
        ElMessage.warning('积分不足，请向超级管理员申请');
        return;
    }
    loading.value = true;
    try {
        // 1. 从连接读取数据
        const finalPrompt = connectedPrompt.value;
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
            if (quality.value) requestParams.quality = quality.value;
            if (nanoModel.value) requestParams.model = nanoModel.value;
            console.log(`[前端] Nano Banana 模型=${nanoModel.value || 'nano-banana-2'}, 比例=${aspectRatio.value}, 分辨率=${quality.value || '2K'}`);
        }
        
        console.log('发送生图请求，参数:', requestParams);

        // 在发送请求前，根据生成数量预创建占位图片节点（loading 状态）
        const expectedCount = numImages.value || 1;
        createPlaceholderImageNodes(expectedCount);

        const res: any = await generateImage(requestParams);
        
        console.log('👉 后端原始返回:', res);
        // 后端返回格式: { message: "任务提交成功", data: { image_url: "...", all_images: [...] } }
        if (res.data) {
            // 处理多图结果
            const allImages = res.data.all_images || (res.data.image_url ? [res.data.image_url] : []);
            
            if (allImages.length > 0) {
                // 转换所有图片URL为完整URL
                const fullUrls = allImages.map((url: string) => getUploadUrl(url));
                
                imageUrls.value = fullUrls;
                imageUrl.value = fullUrls[0]; // 第一张作为主图
                
                // 更新节点数据，供下游节点使用
                props.data.imageUrl = res.data.image_url || allImages[0];
                props.data.imageUrls = allImages;
                
                console.log(`👉 成功生成 ${fullUrls.length} 张图片:`, fullUrls);
                ElMessage.success(`成功生成 ${fullUrls.length} 张图片！`);
                creditTracker?.addSpent?.(executeCost.value);
                userStore.fetchCredits();
                
                // 标记节点为已执行（下次显示“再次执行”）
                isExecuted.value = true;
                
                // 用真实图片填充占位节点；若不存在占位，则按老逻辑创建新节点
                if (!fillPlaceholderImageNodes(fullUrls, allImages) && fullUrls.length > 0 && currentNode.value) {
                    createImageNodes(fullUrls, allImages);
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
            } else if (res.data.image_url) {
                // 兼容旧格式：只有 image_url
                const url = res.data.image_url.startsWith('http')
                    ? res.data.image_url
                    : getUploadUrl(res.data.image_url);
                imageUrl.value = url;
                imageUrls.value = [url];
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

        // 如果存在占位图片节点，将其标记为失败状态，以便在 ImageNode 中展示“生成失败”
        markPendingPlaceholdersAsError();

        const errMsg =
            (error as Error)?.message ||
            (typeof error === 'string' ? error : '') ||
            '图片生成失败，请稍后重试';
        void notifyMediaGeneration({
            kind: 'image',
            success: false,
            nodeId: String(props.id),
            message: errMsg
        });

        ElMessage.error('图片生成失败，请稍后重试');
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
            prompt: connectedPrompt.value || '',
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
const createPlaceholderImageNodes = (count: number) => {
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

const workflowPersistence = inject<WorkflowPersistenceStore | null>('workflowPersistence', null);
const saveWorkflowImmediately = () => {
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

.execute-btn {
    width: 100%;
    margin-top: 8px;
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