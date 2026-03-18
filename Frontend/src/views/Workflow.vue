<template>
    <div class="workflow-container">
        <!-- 悬浮返回按钮 -->
        <el-button text @click="handleGoBack" class="back-button-float">
            <el-icon>
                <ArrowLeft />
            </el-icon>
            返回
        </el-button>

        <!-- 右上角用户信息与积分 -->
        <div class="workflow-header-float">
            <div class="workflow-user-info">
                <el-avatar :size="28" class="workflow-avatar">
                    {{ userStore.userInfo.username?.charAt(0).toUpperCase() || 'U' }}
                </el-avatar>
                <div class="workflow-user-details">
                    <span class="workflow-username">{{ userStore.userInfo.username || '用户' }}</span>
                    <span class="workflow-credits" v-if="userStore.userInfo.role !== 1">
                        积分 {{ userStore.userInfo.credits ?? 0 }}
                        <el-button text type="primary" size="small" @click="showApplyCreditsModal = true">申请</el-button>
                    </span>
                </div>
            </div>
            <div class="workflow-save-info">
                <el-button
                    size="small"
                    type="primary"
                    text
                    :loading="manualSaving"
                    @click="handleManualSave"
                >
                    保存工作流
                </el-button>
                <span v-if="lastSavedAt" class="workflow-save-time">
                    已保存：{{ lastSavedAtText }}
                </span>
                <span v-else class="workflow-save-time workflow-save-time--pending">
                    尚未保存
                </span>
                <span v-if="autoSaveError" class="workflow-save-warning">
                    {{ autoSaveError }}
                </span>
            </div>
        </div>

        <!-- 申请积分弹窗 -->
        <el-dialog v-model="showApplyCreditsModal" title="申请积分" width="400px">
            <el-form :model="applyCreditsForm" label-width="80px">
                <el-form-item label="申请数量">
                    <el-input-number v-model="applyCreditsForm.amount" :min="1" :max="10000" />
                </el-form-item>
                <el-form-item label="申请原因">
                    <el-input v-model="applyCreditsForm.reason" type="textarea" :rows="3" placeholder="请输入申请原因（可选）" />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="showApplyCreditsModal = false">取消</el-button>
                <el-button type="primary" :loading="applyCreditsLoading" @click="handleApplyCredits">提交</el-button>
            </template>
        </el-dialog>

        <div ref="canvasWrapperRef" class="canvas-wrapper" @dragover.prevent="handleDragOver" @drop.prevent="handleDrop"
            @contextmenu.prevent="handleCanvasContextMenu">
            <!-- 左侧功能图标栏 -->
            <div class="side-toolbar">
                <div class="side-group side-group-primary">
                    <el-tooltip content="添加提示词节点" placement="right">
                        <el-button circle class="side-btn" @click="addPromptNodeFromToolbar">
                            <el-icon>
                                <EditPen />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加图片节点" placement="right">
                        <el-button circle class="side-btn" @click="addImageNodeFromToolbar">
                            <el-icon>
                                <Picture />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加生图节点" placement="right">
                        <el-button circle class="side-btn" @click="addNode">
                            <el-icon>
                                <MagicStick />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加放大节点" placement="right">
                        <el-button circle class="side-btn" @click="addUpscaleNode">
                            <el-icon>
                                <ZoomIn />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加扩展节点" placement="right">
                        <el-button circle class="side-btn" @click="addExtendNode">
                            <el-icon>
                                <FullScreen />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加图层分离节点" placement="right">
                        <el-button circle class="side-btn" @click="addLayerSeparationNode">
                            <el-icon>
                                <Grid />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加视频节点" placement="right">
                        <el-button circle class="side-btn" @click="addVideoRefNode">
                            <el-icon>
                                <VideoCamera />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加音频节点" placement="right">
                        <el-button circle class="side-btn" @click="addAudioRefNode">
                            <el-icon>
                                <Headset />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                </div>

                <div class="side-divider"></div>

                <div class="side-group side-group-secondary">
                    <el-tooltip content="保存模板" placement="right">
                        <el-button circle class="side-btn" @click="() => { loadCategories(); showSaveDialog = true; }">
                            <el-icon>
                                <Collection />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="加载模板" placement="right">
                        <el-button circle class="side-btn" @click="showLoadDialogHandler">
                            <el-icon>
                                <FolderOpened />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="历史记录" placement="right">
                        <el-button circle class="side-btn" @click="showHistoryDialogHandler">
                            <el-icon>
                                <Clock />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                </div>

                <div class="side-divider"></div>

                <div class="side-group side-group-secondary">
                    <el-tooltip content="撤销 (Ctrl+Z)" placement="right">
                        <el-button circle class="side-btn" @click="undo" :disabled="undoStack.length === 0">
                            <el-icon>
                                <RefreshLeft />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="重做 (Ctrl+Y)" placement="right">
                        <el-button circle class="side-btn" @click="redo" :disabled="redoStack.length === 0">
                            <el-icon>
                                <RefreshRight />
                            </el-icon>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>

            <VueFlow ref="vueFlowRef" :nodes="nodes" :edges="edges" :node-types="nodeTypes as any" :edge-options="{ animated: true }"
                :connection-line-style="{ stroke: 'var(--color-primary)', strokeWidth: 2, strokeDasharray: '5,5' }" :connection-radius="20"
                :snap-to-grid="true" :snap-grid="[15, 15]" :nodes-connectable="true" :edges-updatable="true"
                :nodes-draggable="!isSpacePressed" :select-nodes-on-drag="!isSpacePressed"
                :elements-selectable="true"
                :selection-key-code="selectionKeyCode"
                :delete-key-code="null"
                :pan-on-drag="panOnDrag"
                :pan-on-scroll="true" :zoom-on-scroll="true" :zoom-on-double-click="true" :min-zoom="0.2" :max-zoom="4"
                :default-viewport="{ x: 0, y: 0, zoom: 0.8 }" :infinite="true" :only-render-visible-elements="true"
                @mousemove="handleCanvasMouseMove"
                @connect="onConnect" @connect-start="handleConnectStart" @connect-end="handleConnectEnd"
                @pane-contextmenu="handlePaneContextMenu">
                <Background pattern-color="#2d2e36" :gap="8" />
                <Controls />
                <MiniMap mask-color="#212228" node-color="#191a1e" />
            </VueFlow>

            <!-- 右键菜单 -->
            <ContextMenu
                :visible="contextMenuVisible"
                :position="contextMenuPosition"
                @insert-prompt="insertPromptNode"
                @insert-image="insertImageNode"
                @insert-dream="insertDreamNode"
                @insert-video="insertVideoNode"
                @insert-video-ref="insertVideoRefNode"
                @insert-audio-ref="insertAudioRefNode"
                @insert-layer-separation="insertLayerSeparationNode"
                @add-group="handleAddGroup"
                @close="contextMenuVisible = false"
            />

            <!-- 连接菜单 -->
            <ConnectionMenu :visible="connectionMenuVisible" :position="connectionMenuPosition"
                @generate-image="handleConnectToImage" @generate-video="handleConnectToVideo"
                @close="connectionMenuVisible = false" />
        </div>

        <!-- 保存模板对话框 -->
        <el-dialog v-model="showSaveDialog" title="保存工作流模板" width="600px"
            @opened="() => { loadCategories(); saveForm.coverImage = getLastImageFromWorkflow(); }">
            <el-form :model="saveForm" label-width="100px">
                <el-form-item label="模板名称">
                    <el-input v-model="saveForm.name" placeholder="请输入模板名称" />
                </el-form-item>
                <el-form-item label="模板描述">
                    <el-input v-model="saveForm.description" type="textarea" :rows="3" placeholder="请输入模板描述（可选）" />
                </el-form-item>
                <el-form-item label="封面图片">
                    <div style="display: flex; gap: 12px; align-items: flex-start;">
                        <el-image v-if="saveForm.coverImage" :src="saveForm.coverImage"
                            style="width: 120px; height: 120px; border: 1px solid #ddd; border-radius: 4px;" fit="cover"
                            :preview-src-list="[saveForm.coverImage]" />
                        <div v-else
                            style="width: 120px; height: 120px; border: 1px dashed #ddd; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999;">
                            暂无封面
                        </div>
                        <div style="flex: 1;">
                            <el-button size="small" @click="selectCoverImage">选择封面</el-button>
                            <div style="margin-top: 8px; font-size: 12px; color: #999;">
                                默认使用工作流最后一张图片作为封面
                            </div>
                        </div>
                    </div>
                </el-form-item>
                <el-form-item label="分类" required>
                    <el-select v-model="saveForm.category" placeholder="请选择分类" style="width: 100%">
                        <el-option v-for="cat in categories" :key="cat.code" :label="cat.name" :value="cat.code" />
                    </el-select>
                </el-form-item>
                <el-form-item label="是否公开">
                    <el-switch v-model="saveForm.isPublic" />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="showSaveDialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="handleSaveTemplate">保存</el-button>
            </template>
        </el-dialog>

        <!-- 加载模板对话框 -->
        <el-dialog v-model="showLoadDialog" title="加载工作流模板" width="700px">
            <el-table :data="templates" border style="width: 100%">
                <el-table-column prop="name" label="模板名称" />
                <el-table-column prop="description" label="描述" />
                <el-table-column prop="usage_count" label="使用次数" width="100" />
                <el-table-column prop="updated_at" label="更新时间" width="180" />
                <el-table-column label="操作" width="150">
                    <template #default="{ row }">
                        <el-button size="small" type="primary" @click="handleLoadTemplate(row)">加载</el-button>
                        <el-button size="small" type="danger" @click="handleDeleteTemplate(row.id)">删除</el-button>
                    </template>
                </el-table-column>
            </el-table>
        </el-dialog>

        <!-- 历史记录对话框 -->
        <el-dialog v-model="showHistoryDialog" title="工作流历史记录" width="700px">
            <el-table :data="histories" border style="width: 100%">
                <el-table-column prop="snapshot_name" label="快照名称" />
                <el-table-column prop="created_at" label="保存时间" width="180" />
                <el-table-column label="操作" width="150">
                    <template #default="{ row }">
                        <el-button size="small" type="primary" @click="handleLoadHistory(row)">恢复</el-button>
                        <el-button size="small" type="danger" @click="handleDeleteHistory(row.id)">删除</el-button>
                    </template>
                </el-table-column>
            </el-table>
        </el-dialog>

        <!-- Gemini 聊天面板（包含右侧悬浮开关按钮） -->
        <WorkflowChatPanel :workflow-context="workflowContextForChat" />
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, markRaw, onMounted, onUnmounted, h, provide, nextTick, computed } from 'vue';
import { useRouter, useRoute, onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/store/user';
import { VueFlow, useVueFlow, type Connection } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, RefreshLeft, RefreshRight, Picture, ZoomIn, FullScreen, Collection, FolderOpened, Clock, EditPen, MagicStick, KnifeFork, Grid, VideoCamera, Headset } from '@element-plus/icons-vue';
import { saveTemplate, getTemplates, getTemplate, updateTemplate, deleteTemplate, autoSaveHistory, getHistoryList, getHistory, deleteHistory as deleteHistoryApi, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';
import { getActiveCategories, type WorkflowCategory } from '@/api/category';
import { applyCredits } from '@/api/user';
import { uploadImage, uploadVideo, uploadAudio } from '@/api/upload';
import html2canvas from 'html2canvas';
import ContextMenu from '@/components/ContextMenu.vue';
import ConnectionMenu from '@/components/ConnectionMenu.vue';
import WorkflowChatPanel from '@/components/WorkflowChatPanel.vue';
import { getUploadUrl } from '@/utils/image-loader';
import { getMediaMetadataFromFile } from '@/utils/media-metadata';

// 引入默认样式
import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

// 引入自定义节点
import DreamNode from '@/components/nodes/DreamNode.vue';
import UpscaleNode from '@/components/nodes/UpscaleNode.vue';
import ExtendNode from '@/components/nodes/ExtendNode.vue';
import ImageNode from '@/components/nodes/ImageNode.vue';
import LayerNode from '@/components/nodes/LayerNode.vue';
import PromptNode from '@/components/nodes/PromptNode.vue';
import VideoNode from '@/components/nodes/VideoNode.vue';
import LayerSeparationNode from '@/components/nodes/LayerSeparationNode.vue';
import VideoRefNode from '@/components/nodes/VideoRefNode.vue';
import AudioRefNode from '@/components/nodes/AudioRefNode.vue';
import VideoResultNode from '@/components/nodes/VideoResultNode.vue';

// 注册节点类型
const nodeTypes = {
    dream: markRaw(DreamNode),
    upscale: markRaw(UpscaleNode),
    extend: markRaw(ExtendNode),
    image: markRaw(ImageNode),
    layer: markRaw(LayerNode),
    prompt: markRaw(PromptNode),
    video: markRaw(VideoNode),
    layerSeparation: markRaw(LayerSeparationNode),
    videoRef: markRaw(VideoRefNode),
    audioRef: markRaw(AudioRefNode),
    videoResult: markRaw(VideoResultNode),
};

type WorkflowDTO = {
    nodes: any[];
    edges: any[];
    cover_image?: string;
    imageAliasCounter?: number;
    imageAliasMap?: Record<string, string>;
};

type WorkflowPersistenceStore = {
    saveImmediately: () => void;
};

// 初始节点数据（默认一个提示词节点）
const nodes = ref([
    {
        id: '1',
        type: 'prompt',
        position: { x: 250, y: 100 },
        data: { text: '' },
    },
]);

// 初始边数据
const edges = ref([]);

// 复制的节点与连线（用于 Ctrl+C / Ctrl+V，仅节点复制粘贴）
const copiedSelection = ref<{ nodes: any[]; edges: any[] } | null>(null);
// 标记本次粘贴是否已在 paste 事件中处理过（避免 keydown 兜底与 paste 重复执行）
const didHandlePasteThisCycle = ref(false);

// 图片别名：按工作流范围自增（图1、图2...）
type ImageAliasStore = {
    getOrCreateAlias: (imageKey: string) => string;
    getAllAliases: () => { key: string; alias: string }[];
};

const imageAliasCounter = ref(0);
const imageAliasMap = ref<Record<string, string>>({});

const getOrCreateImageAlias = (imageKey: string): string => {
    if (!imageKey) return '';
    const existing = imageAliasMap.value[imageKey];
    if (existing) return existing;
    const nextIndex = imageAliasCounter.value + 1;
    const alias = `图${nextIndex}`;
    imageAliasCounter.value = nextIndex;
    imageAliasMap.value = {
        ...imageAliasMap.value,
        [imageKey]: alias,
    };
    return alias;
};

const getAllImageAliases = () => {
    return Object.entries(imageAliasMap.value).map(([key, alias]) => ({ key, alias }));
};

const restoreImageAliasStateFromWorkflow = (workflowData: any) => {
    if (workflowData && typeof workflowData === 'object') {
        if (typeof workflowData.imageAliasCounter === 'number') {
            imageAliasCounter.value = workflowData.imageAliasCounter;
        }
        if (workflowData.imageAliasMap && typeof workflowData.imageAliasMap === 'object') {
            imageAliasMap.value = { ...workflowData.imageAliasMap };
            return;
        }
    }

    // 兼容旧数据：从节点里推导已有别名
    const currentNodes = workflowData?.nodes || getNodes.value;
    const map: Record<string, string> = {};
    let maxIndex = 0;
    for (const node of currentNodes || []) {
        if (node.type !== 'image') continue;
        const data = node.data || {};
        const alias: string | undefined = data.imageAlias;
        const key: string | undefined = data.originalImageUrl || data.imageUrl;
        if (!alias || !key) continue;
        if (!map[key]) {
            map[key] = alias;
            const match = alias.match(/^图(\d+)$/);
            if (match) {
                const n = Number(match[1]);
                if (!Number.isNaN(n)) {
                    maxIndex = Math.max(maxIndex, n);
                }
            }
        }
    }
    imageAliasMap.value = map;
    imageAliasCounter.value = maxIndex;
};

provide<ImageAliasStore>('imageAliasStore', {
    getOrCreateAlias: getOrCreateImageAlias,
    getAllAliases: getAllImageAliases,
});

// 视频 / 音频别名：按工作流范围自增（视频1、音频1...），用于 @ 引用
type MediaAliasStore = {
    getOrCreateVideoAlias: (key: string) => string;
    getOrCreateAudioAlias: (key: string) => string;
};

const videoAliasCounter = ref(0);
const audioAliasCounter = ref(0);
const videoAliasMap = ref<Record<string, string>>({});
const audioAliasMap = ref<Record<string, string>>({});

const getOrCreateVideoAlias = (key: string): string => {
    if (!key) return '';
    const existing = videoAliasMap.value[key];
    if (existing) return existing;
    const nextIndex = videoAliasCounter.value + 1;
    const alias = `视频${nextIndex}`;
    videoAliasCounter.value = nextIndex;
    videoAliasMap.value = {
        ...videoAliasMap.value,
        [key]: alias,
    };
    return alias;
};

const getOrCreateAudioAlias = (key: string): string => {
    if (!key) return '';
    const existing = audioAliasMap.value[key];
    if (existing) return existing;
    const nextIndex = audioAliasCounter.value + 1;
    const alias = `音频${nextIndex}`;
    audioAliasCounter.value = nextIndex;
    audioAliasMap.value = {
        ...audioAliasMap.value,
        [key]: alias,
    };
    return alias;
};

provide<MediaAliasStore>('mediaAliasStore', {
    getOrCreateVideoAlias,
    getOrCreateAudioAlias,
});

// 撤销/重做栈管理
const undoStack = ref<any[]>([]);
const redoStack = ref<any[]>([]);
const MAX_UNDO_STACK_SIZE = 50; // 最大撤销栈大小
const hasPendingChanges = ref(false);

// 保存当前状态到撤销栈
const saveState = () => {
    // 清除重做栈
    redoStack.value = [];

    // 保存当前状态
    const currentState = {
        nodes: JSON.parse(JSON.stringify(getNodes.value)),
        edges: JSON.parse(JSON.stringify(getEdges.value))
    };

    // 添加到撤销栈
    undoStack.value.push(currentState);

    // 标记有未保存的更改
    hasPendingChanges.value = true;

    // 限制栈大小
    if (undoStack.value.length > MAX_UNDO_STACK_SIZE) {
        undoStack.value.shift();
    }
};

// 撤销操作
const undo = () => {
    if (undoStack.value.length === 0) {
        ElMessage.info('没有可撤销的操作');
        return;
    }

    // 保存当前状态到重做栈
    const currentState = {
        nodes: JSON.parse(JSON.stringify(getNodes.value)),
        edges: JSON.parse(JSON.stringify(getEdges.value))
    };
    redoStack.value.push(currentState);

    // 从撤销栈弹出上一个状态
    const previousState = undoStack.value.pop();
    if (previousState) {
        setNodes(previousState.nodes);
        setEdges(previousState.edges);
        ElMessage.success('已撤销上一步操作');
    }
};

// 重做操作
const redo = () => {
    if (redoStack.value.length === 0) {
        ElMessage.info('没有可重做的操作');
        return;
    }

    // 保存当前状态到撤销栈
    const currentState = {
        nodes: JSON.parse(JSON.stringify(getNodes.value)),
        edges: JSON.parse(JSON.stringify(getEdges.value))
    };
    undoStack.value.push(currentState);

    // 从重做栈弹出下一个状态
    const nextState = redoStack.value.pop();
    if (nextState) {
        setNodes(nextState.nodes);
        setEdges(nextState.edges);
        ElMessage.success('已重做操作');
    }
};



const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const showApplyCreditsModal = ref(false);
const applyCreditsForm = reactive({ amount: 10, reason: '' });
const applyCreditsLoading = ref(false);
const handleApplyCredits = async () => {
    applyCreditsLoading.value = true;
    try {
        await applyCredits(applyCreditsForm.amount, applyCreditsForm.reason);
        ElMessage.success('申请已提交，请等待管理员审核');
        showApplyCreditsModal.value = false;
        applyCreditsForm.amount = 10;
        applyCreditsForm.reason = '';
    } catch {
        // error handled by request interceptor
    } finally {
        applyCreditsLoading.value = false;
    }
};
const { addNodes, addEdges, getEdges, getNodes, setNodes, setEdges, removeNodes, findNode, screenToFlowCoordinate, viewport, fitView } = useVueFlow();
/** 从「我的项目」进入时的模板 id，保存时覆盖该模板；否则保存为新项目 */
const currentTemplateId = ref<number | null>(null);
/** 当前打开的模板所属用户 id，与当前用户一致时保存为覆盖 */
const templateOwnerId = ref<number | null>(null);
/** 若当前为从公开模板派生的临时项目，则记录来源公开模板 ID */
const sourceTemplateIdForTemp = ref<number | null>(null);
const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);
const canvasWrapperRef = ref<HTMLElement | null>(null);
/** 当前编辑对应的历史记录 id：从历史打开时设为该 id，首次自动保存后回填，后续保存均覆盖此条 */
const currentHistoryId = ref<number | null>(null);

const manualSaving = ref(false);
const lastSavedAt = ref<Date | null>(null);
/** 最近一次自动保存/手动保存是否失败，用于在 UI 中提示用户 */
const autoSaveError = ref<string | null>(null);
const lastSavedAtText = computed(() => {
    if (!lastSavedAt.value) return '';
    try {
        return lastSavedAt.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '';
    }
});

const buildWorkflowDataForSave = (): WorkflowDTO => ({
    nodes: getNodes.value,
    edges: getEdges.value,
    imageAliasCounter: imageAliasCounter.value,
    imageAliasMap: imageAliasMap.value,
});

const clearUndoRedoAndPending = () => {
    undoStack.value = [];
    redoStack.value = [];
    hasPendingChanges.value = false;
};

/**
 * 确保当前会话有对应的项目（模板）ID：
 * - 若已从“我的项目”进入，则直接复用 existing templateId；
 * - 若从新建 / 历史 / 公开项目进入，则在第一次持久化时创建一个“临时项目”。
 */
const ensureCurrentTemplate = async (workflowData: WorkflowDTO) => {
    if (currentTemplateId.value != null) return;

    const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
    try {
        const tempName = '临时项目';
        const payload = {
            name: tempName,
            description: '',
            workflowData,
            isPublic: false,
            coverImage: workflowData.cover_image,
            // 使用一个固定的草稿分类，后端不会校验类别是否存在
            category: 'draft',
            // 标记为临时项目，并在从公开模板派生时记录来源 ID
            isTemp: true,
            ...(sourceTemplateIdForTemp.value != null ? { sourceTemplateId: sourceTemplateIdForTemp.value } : {}),
        };
        const res: any = await saveTemplate(payload);
        const template: WorkflowTemplate | undefined = res?.data;
        if (template && template.id != null) {
            currentTemplateId.value = template.id;
            templateOwnerId.value = myId;
        }
    } catch (error: any) {
        console.error('创建临时项目失败:', error);
        // 不抛出，让调用方处理是否继续仅依赖历史记录
    }
};

const persistWorkflow = async () => {
    const currentNodes = getNodes.value;
    if (currentNodes.length === 0) return false;

    const workflowData: WorkflowDTO = buildWorkflowDataForSave();
    await ensureWorkflowCover(workflowData);

    try {
        // 确保当前会话有对应的项目 ID（从新建 / 历史 / 公开项目进入时会触发）
        await ensureCurrentTemplate(workflowData);

        const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
        const isOwnTemplate =
            currentTemplateId.value != null &&
            templateOwnerId.value != null &&
            myId != null &&
            templateOwnerId.value === myId;

        let historyRes: any = null;

        // 1. 先更新模板本身（如果当前是“我的项目”里的模板）
        if (isOwnTemplate) {
            await updateTemplate(currentTemplateId.value!, {
                workflowData,
                coverImage: workflowData.cover_image,
            });
        }

        // 2. 无论是否模板，都为当前编辑会话保留一条自动保存历史，用于刷新/重新进入时恢复
        const templateIdForSave = currentTemplateId.value != null ? currentTemplateId.value : undefined;
        if (currentHistoryId.value != null) {
            historyRes = await autoSaveHistory(workflowData, currentHistoryId.value, templateIdForSave);
        } else {
            historyRes = await autoSaveHistory(workflowData, undefined, templateIdForSave);
        }

        if (historyRes?.data?.id != null) {
            currentHistoryId.value = historyRes.data.id;
            window.localStorage.setItem('workflow:lastHistoryId', String(historyRes.data.id));
        }

        hasPendingChanges.value = false;
        lastSavedAt.value = new Date();
        autoSaveError.value = null;
        return true;
    } catch (error: any) {
        console.error('工作流持久化失败:', error);
        const msg = error?.message || '自动保存失败，请手动保存或拆分项目';
        autoSaveError.value = msg;
        // 自动保存场景不打扰太多，这里使用 warning 提示
        ElMessage.warning(msg);
        return false;
    }
};

const workflowPersistenceStore: WorkflowPersistenceStore = {
    saveImmediately: () => {
        hasPendingChanges.value = true;
        persistWorkflow().catch((error: any) => {
            console.error('关键操作保存失败（workflowPersistenceStore）:', error);
        });
    },
};

provide<WorkflowPersistenceStore>('workflowPersistence', workflowPersistenceStore);

// 提供给 Gemini 聊天的工作流上下文（精简版）
const workflowContextForChat = computed(() => {
    const nodes = getNodes.value;
    const edges = getEdges.value;
    const selectedNodes = nodes.filter(node => node.selected);

    return {
        historyId: currentHistoryId.value,
        templateId: currentTemplateId.value,
        nodesCount: nodes.length,
        edgesCount: edges.length,
        selectedNodes: selectedNodes.map(node => ({
            id: node.id,
            type: node.type,
            label: (node.data as any)?.label,
            text: (node.data as any)?.text,
        })),
    };
});

// 截取画布作为封面图，上传后返回 URL；失败返回 null
const captureCanvasCover = async (): Promise<string | null> => {
    await nextTick();
    let targetEl: HTMLElement | null = null;
    const flowInstance = vueFlowRef.value;
    const flowEl = flowInstance && typeof flowInstance === 'object' && (flowInstance as any).$el;
    if (flowEl) {
        const viewport = flowEl.querySelector?.('.vue-flow__viewport');
        targetEl = (viewport as HTMLElement) || flowEl;
    }
    if (!targetEl && canvasWrapperRef.value) targetEl = canvasWrapperRef.value;
    if (!targetEl) return null;
    try {
        const canvas = await html2canvas(targetEl, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#1b1c21',
            scale: 0.5,
            logging: false
        });
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.8));
        if (!blob) return null;
        const file = new File([blob], 'workflow-cover.png', { type: 'image/png' });
        const res: any = await uploadImage(file);
        const url = res?.data?.url;
        if (!url) return null;
        return url.startsWith('http') ? url : getUploadUrl(url);
    } catch (e) {
        console.warn('画布截图失败', e);
        return null;
    }
};

// 若 workflow 没有封面则优先使用最后一张图片作为封面；若没有图片，再尝试画布截图（会修改 workflowData）
const ensureWorkflowCover = async (workflowData: { nodes: any[]; edges: any[]; cover_image?: string }) => {
    if (workflowData.cover_image) return;

    // 1. 优先使用工作流中的最后一张图片
    const lastImage = getLastImageFromWorkflow();
    if (lastImage) {
        workflowData.cover_image = lastImage;
        return;
    }

    // 2. 若没有图片，则尝试对画布截图
    const url = await captureCanvasCover();
    if (url) workflowData.cover_image = url;
};

// 节点尺寸映射（根据实际节点大小）
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
'image': { width: 240, height: 300 },
'prompt': { width: 360, height: 460 },
'dream': { width: 400, height: 500 },
    'upscale': { width: 280, height: 350 },
    'extend': { width: 280, height: 350 },
    'video': { width: 350, height: 450 },
    'layer': { width: 300, height: 400 },
    'split': { width: 280, height: 350 },
    'layerSeparation': { width: 280, height: 400 },
    'videoRef': { width: 260, height: 220 },
    'audioRef': { width: 260, height: 220 },
    'videoResult': { width: 320, height: 280 },
};

// 间距配置
const HORIZONTAL_PADDING = 80; // 水平间距
const VERTICAL_PADDING = 60;   // 垂直间距

/**
 * 计算新节点的最佳位置，避免与现有节点重叠
 * @param nodeType 节点类型
 * @param preferredPosition 首选位置（可选，如鼠标位置）
 * @returns 计算出的位置坐标
 */
const calculateOptimalPosition = (
    nodeType: string,
    preferredPosition?: { x: number; y: number }
): { x: number; y: number } => {
    const dimensions = NODE_DIMENSIONS[nodeType] || { width: 300, height: 400 };
    const gridWidth = dimensions.width + HORIZONTAL_PADDING;
    const gridHeight = dimensions.height + VERTICAL_PADDING;

    // 获取所有现有节点
    const existingNodes = getNodes.value;

    // 确定搜索起始位置
    let startX: number;
    let startY: number;

    if (preferredPosition) {
        // 如果有首选位置（如鼠标位置），从该位置开始搜索
        startX = preferredPosition.x;
        startY = preferredPosition.y;
    } else {
        // 否则使用鼠标当前位置作为起始位置，确保节点在视口内
        // 获取鼠标当前位置
        const mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        // 转换为画布坐标
        const canvasPosition = screenToFlowCoordinate(mousePosition);
        startX = canvasPosition.x;
        startY = canvasPosition.y;
    }

    // 对齐到网格
    const gridStartX = Math.floor(startX / gridWidth) * gridWidth;
    const gridStartY = Math.floor(startY / gridHeight) * gridHeight;

    // 碰撞检测函数
    const checkCollision = (x: number, y: number): boolean => {
        const newNodeRect = {
            left: x,
            top: y,
            right: x + dimensions.width,
            bottom: y + dimensions.height
        };

        for (const node of existingNodes) {
            const nodeDim = NODE_DIMENSIONS[node.type || 'dream'] || { width: 300, height: 400 };
            const nodeRect = {
                left: node.position.x,
                top: node.position.y,
                right: node.position.x + nodeDim.width,
                bottom: node.position.y + nodeDim.height
            };

            // 矩形碰撞检测（带安全边距）
            const padding = 20;
            if (
                newNodeRect.left < nodeRect.right + padding &&
                newNodeRect.right > nodeRect.left - padding &&
                newNodeRect.top < nodeRect.bottom + padding &&
                newNodeRect.bottom > nodeRect.top - padding
            ) {
                return true; // 发生碰撞
            }
        }
        return false; // 无碰撞
    };

    // 螺旋搜索算法：从起始位置开始，按螺旋方式向外搜索
    const maxRadius = 20; // 最大搜索半径（网格单位）

    for (let radius = 0; radius <= maxRadius; radius++) {
        // 搜索当前半径的所有位置
        const positions: { x: number; y: number }[] = [];

        if (radius === 0) {
            positions.push({ x: gridStartX, y: gridStartY });
        } else {
            // 生成当前半径的所有网格位置
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    // 只检查边界上的点（形成螺旋）
                    if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                        positions.push({
                            x: gridStartX + dx * gridWidth,
                            y: gridStartY + dy * gridHeight
                        });
                    }
                }
            }
        }

        // 检查每个位置
        for (const pos of positions) {
            if (!checkCollision(pos.x, pos.y)) {
                return pos; // 找到可用位置
            }
        }
    }

    // 如果所有位置都被占用，返回起始位置（用户需要手动调整）
    return { x: gridStartX, y: gridStartY };
};

// 封装一次保存当前工作流的逻辑：离开编辑器页面时统一调用
const saveCurrentWorkflowBeforeLeave = async () => {
    await persistWorkflow();
};

// 返回上一页：只负责路由返回，真正的保存逻辑在 onBeforeRouteLeave 中统一处理
const handleGoBack = () => {
    router.back();
};

const handleManualSave = async () => {
    if (manualSaving.value) return;
    if (getNodes.value.length === 0) {
        ElMessage.warning('当前没有工作流内容可保存');
        return;
    }
    manualSaving.value = true;
    try {
        const ok = await persistWorkflow();
        if (ok) {
            ElMessage.success('工作流已保存');
        }
    } catch (error: any) {
        console.error('手动保存失败:', error);
        ElMessage.error(error?.message || '保存失败，请稍后重试');
    } finally {
        manualSaving.value = false;
    }
};


// 模板相关
const showSaveDialog = ref(false);
const showLoadDialog = ref(false);
const saving = ref(false);
const templates = ref<WorkflowTemplate[]>([]);
const saveForm = ref({
    name: '',
    description: '',
    isPublic: false,
    coverImage: '' as string,
    category: '' as string
});
const categories = ref<WorkflowCategory[]>([]);

// 获取工作流中最后一张图片作为默认封面
const getLastImageFromWorkflow = (): string => {
    const nodes = getNodes.value;
    // 查找所有图片节点，按创建时间或位置排序，取最后一张
    const imageNodes = nodes
        .filter(node => node.type === 'image' && node.data?.imageUrl)
        .sort((a, b) => {
            // 按位置排序：x坐标大的优先，如果x相同则按y坐标
            if (a.position.x !== b.position.x) {
                return b.position.x - a.position.x;
            }
            return b.position.y - a.position.y;
        });

    if (imageNodes.length > 0 && imageNodes[0]) {
        const lastImageUrl = imageNodes[0].data?.imageUrl;
        if (!lastImageUrl) return '';
        return getUploadUrl(lastImageUrl);
    }
    return '';
};

// 选择封面图片
const selectCoverImage = () => {
    const nodes = getNodes.value;
    const imageNodes = nodes
        .filter(node => node.type === 'image' && node.data?.imageUrl)
        .map(node => {
            const url = node.data.imageUrl;
            const fullUrl = getUploadUrl(url);
            return {
                id: node.id,
                url: fullUrl,
                originalUrl: url
            };
        });

    if (imageNodes.length === 0) {
        ElMessage.warning('工作流中没有图片节点');
        return;
    }

    // 使用 ElMessageBox 显示图片选择对话框
    ElMessageBox({
        title: '选择封面图片',
        message: h('div', { style: 'max-height: 500px; overflow-y: auto;' }, [
            h('div', { style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 12px;' },
                imageNodes.map(img =>
                    h('div', {
                        style: 'cursor: pointer; border: 2px solid #ddd; border-radius: 4px; overflow: hidden;',
                        onClick: () => {
                            saveForm.value.coverImage = img.url;
                            ElMessageBox.close();
                        }
                    }, [
                        h('img', {
                            src: img.url,
                            style: 'width: 100%; height: 150px; object-fit: cover;'
                        })
                    ])
                )
            )
        ]),
        showCancelButton: true,
        confirmButtonText: '取消',
        showConfirmButton: false
    });
};
const showHistoryDialog = ref(false);
const histories = ref<WorkflowHistory[]>([]);
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

// Space 按住才允许用左键拖拽平移画布；中键始终可以拖拽
const isSpacePressed = ref(false);
// panOnDrag 接受鼠标按键编号：0=左键, 1=中键, 2=右键
// 需求：中键一直能拖；按住空格时，左键也能拖
const panOnDrag = computed(() =>
    isSpacePressed.value ? [0, 1] : [1]
);
// 框选：true 表示无需按修饰键即可在空白处拖拽出选择框（与 select-nodes-on-drag 配合）
const selectionKeyCode = ref<boolean | null>(true);

// 记录鼠标在画布上的最后位置，用于粘贴图片时确定节点位置
const lastMousePosition = ref<{ x: number; y: number } | null>(null);

// 右键菜单状态
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });

// 连接菜单状态
const connectionMenuVisible = ref(false);
const connectionMenuPosition = ref({ x: 0, y: 0 });
const pendingConnection = ref<{ source: string; sourceHandle?: string; position: { x: number; y: number } } | null>(null);
const connectStartInfo = ref<{ source: string; sourceHandle?: string } | null>(null);
const didConnect = ref(false);

// 连接验证函数：增强验证逻辑
const isValidConnection = (connection: Connection) => {
    console.log('连接验证:', connection);

    // 不允许自己连接自己
    if (connection.source === connection.target) {
        return false;
    }

    // 获取源节点和目标节点
    const sourceNode = findNode(connection.source);
    const targetNode = findNode(connection.target);

    if (!sourceNode || !targetNode) {
        return false;
    }

    // 图片/提示词节点作为 target 的限制
    if (targetNode.type === 'image' || targetNode.type === 'prompt') {
        // ✅ 允许“由生图节点生成的图片节点”作为输入被连线（它们的 data.fromNodeId 存在）
        if (targetNode.type === 'image' && (targetNode.data as any)?.fromNodeId) {
            return true;
        }

        // 其他情况一律禁止作为输入（包括用户上传的图片节点）
        ElMessage.warning('该节点不支持作为输入被连接');
        return false;
    }

    // 视频节点作为 target：允许来自 prompt / image / videoRef / audioRef / videoResult
    if (targetNode.type === 'video') {
        const allowedSources = new Set(['prompt', 'image', 'videoRef', 'audioRef', 'videoResult']);
        if (!allowedSources.has(sourceNode.type || '')) {
            ElMessage.warning('视频节点仅接受提示词、图片、视频参考或音频参考节点的输入');
            return false;
        }
        return true;
    }

    // 拆分节点作为 target 的限制：只接受图片节点的输入
    if (targetNode.type === 'split') {
        if (sourceNode.type !== 'image') {
            ElMessage.warning('拆分节点只接受图片节点的输入');
            return false;
        }
        return true;
    }

    // 如果目标节点是 DreamNode，需要检查连接限制（DreamNode 只有一个 target handle）
    if (targetNode.type === 'dream') {
        // 限制：只允许 prompt / image 作为输入
        if (sourceNode.type !== 'prompt' && sourceNode.type !== 'image') {
            ElMessage.warning('生图节点只接受提示词节点或图片节点的输入');
            return false;
        }

        const existingEdges = getEdges.value;
        const incomingEdges = existingEdges.filter(edge => edge.target === connection.target);

        const existingPromptConnections = incomingEdges.filter(edge => {
            const src = findNode(edge.source);
            return src?.type === 'prompt';
        });
        const existingImageConnections = incomingEdges.filter(edge => {
            const src = findNode(edge.source);
            return src?.type === 'image';
        });

        if (sourceNode.type === 'prompt') {
            if (existingPromptConnections.length >= 1) {
                ElMessage.warning('生图节点最多只能连接1个提示词节点');
                return false;
            }
            return true;
        }

        if (sourceNode.type === 'image') {
            if (existingImageConnections.length >= 4) {
                ElMessage.warning('生图节点最多只能连接4个图片节点');
                return false;
            }
            return true;
        }
    }

    // 放大 / 扩展 节点：只接受来自图片节点的一条输入
    if (targetNode.type === 'upscale' || targetNode.type === 'extend') {
        if (sourceNode.type !== 'image') {
            ElMessage.warning('该节点只接受来自图片节点的一张图片');
            return false;
        }

        const existingEdges = getEdges.value;
        const incomingEdges = existingEdges.filter(edge => edge.target === connection.target);
        if (incomingEdges.length >= 1) {
            ElMessage.warning('该节点只能连接一张图片');
            return false;
        }

        return true;
    }

    // 其他类型的连接允许（如 DreamNode 输出到 ImageNode）
    return true;
};

// 连接成功事件处理
const onConnect = (connection: Connection) => {
    console.log('连接成功:', connection);
    didConnect.value = true;

    if (connection.source && connection.target) {
        // 检查是否已存在相同的连接
        const existingEdges = getEdges.value;
        const duplicate = existingEdges.find(
            edge => edge.source === connection.source &&
                edge.target === connection.target &&
                edge.sourceHandle === connection.sourceHandle &&
                edge.targetHandle === connection.targetHandle
        );

        if (!duplicate) {
            // 使用 addEdges API 添加连接
            addEdges({
                id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle || 'source',
                targetHandle: connection.targetHandle || 'target',
                type: 'default',
                animated: true
            });

            console.log('已添加连接线');
            ElMessage.success('节点连接成功');

            // 保存状态到撤销栈
            saveState();
        } else {
            console.log('连接已存在，跳过');
        }
    }
};

// 拖放处理
const isDragging = ref(false);

// 连接开始：记录 source / sourceHandle，供 connect-end 判断“拖到空白处”
const handleConnectStart = (payload: any) => {
    didConnect.value = false;
    // VueFlow 的 payload 在不同版本/配置下结构可能不同，这里做兼容
    const source =
        payload?.nodeId ??
        payload?.source ??
        payload?.sourceNode?.id ??
        payload?.id ??
        payload?.event?.nodeId;
    const sourceHandle =
        payload?.handleId ??
        payload?.sourceHandle ??
        payload?.handle?.id ??
        payload?.event?.handleId;
    if (source) {
        connectStartInfo.value = { source, sourceHandle };
    } else {
        connectStartInfo.value = null;
    }
};

const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
        isDragging.value = true;
    }
};

// 支持的图片 / 视频 / 音频格式（拖拽上传时区分节点类型）
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const isImageFile = (file: File) => file.type && SUPPORTED_IMAGE_TYPES.includes(file.type);
const isVideoFile = (file: File) => !!file.type && file.type.startsWith('video/');
const isAudioFile = (file: File) => !!file.type && file.type.startsWith('audio/');

const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    isDragging.value = false;

    if (!event.dataTransfer) return;

    const allFiles = Array.from(event.dataTransfer.files);
    if (allFiles.length === 0) {
        ElMessage.warning('请拖放文件');
        return;
    }

    const imageFiles = allFiles.filter(isImageFile);
    const videoFiles = allFiles.filter(isVideoFile);
    const audioFiles = allFiles.filter(isAudioFile);

    if (!imageFiles.length && !videoFiles.length && !audioFiles.length) {
        ElMessage.warning('不支持的文件格式，请上传图片 / 视频 / 音频文件');
        return;
    }

    // 获取鼠标位置并转换为画布坐标
    const position = screenToFlowCoordinate({
        x: event.clientX,
        y: event.clientY
    });

    // 上传文件并创建对应类型的节点
    try {
        let createdCount = 0;

        // 图片 -> ImageNode
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            if (!file) continue;

            const uploadRes: any = await uploadImage(file);

            if (uploadRes.data && uploadRes.data.url) {
                const originalUrl: string = uploadRes.data.url;
                const imageUrl = originalUrl.startsWith('http')
                    ? originalUrl
                    : getUploadUrl(originalUrl);
                const imageKey: string = uploadRes.data.filename || originalUrl;
                const alias = getOrCreateImageAlias(imageKey);

                const nodeId = `image_node_${Date.now()}_${i}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position: {
                        x: position.x + createdCount * 20,
                        y: position.y + createdCount * 20
                    },
                    data: {
                        imageUrl,
                        originalImageUrl: originalUrl,
                        originalFilename: uploadRes.data.filename,
                        imageAlias: alias,
                        imageKey,
                    }
                });
                createdCount++;
            }
        }

        // 视频 -> VideoRefNode（视频节点）
        for (let i = 0; i < videoFiles.length; i++) {
            const file = videoFiles[i];
            if (!file) continue;

            // Seedance 参考视频格式限制：mp4、mov
            const vName = (file.name || '').toLowerCase();
            const vIsMp4 = file.type === 'video/mp4' || vName.endsWith('.mp4');
            const vIsMov = file.type === 'video/quicktime' || vName.endsWith('.mov');
            if (!vIsMp4 && !vIsMov) {
                ElMessage.error('参考视频仅支持 mp4、mov 格式（Seedance 文档限制）');
                continue;
            }

            // Seedance 参考视频文档限制：<=50MB，时长 2-15s
            if (file.size > 50 * 1024 * 1024) {
                ElMessage.error('参考视频不能超过 50MB（Seedance 文档限制）');
                continue;
            }
            let videoDurationSeconds: number | null = null;
            try {
                const meta = await getMediaMetadataFromFile('video', file);
                videoDurationSeconds = meta.durationSeconds;
                if (videoDurationSeconds < 2 || videoDurationSeconds > 15) {
                    ElMessage.error('参考视频时长需在 2-15 秒范围内（Seedance 文档限制）');
                    continue;
                }
            } catch {
                // 拖拽批量上传时不强制阻断 metadata 解析失败，但会缺少时长校验能力
                videoDurationSeconds = null;
            }

            const uploadRes: any = await uploadVideo(file);
            if (uploadRes.data && uploadRes.data.url) {
                const originalUrl: string = uploadRes.data.url;
                const nodeId = `video_ref_node_${Date.now()}_${i}`;
                addNodes({
                    id: nodeId,
                    type: 'videoRef',
                    position: {
                        x: position.x + createdCount * 20,
                        y: position.y + createdCount * 20
                    },
                    data: {
                        url: originalUrl,
                        originalFilename: uploadRes.data.filename,
                        ...(videoDurationSeconds != null ? { durationSeconds: videoDurationSeconds } : {}),
                        sizeBytes: file.size,
                        mimeType: file.type,
                    }
                });
                createdCount++;
            }
        }

        // 音频 -> AudioRefNode（音频节点）
        for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            if (!file) continue;

            // Seedance 参考音频格式限制：mp3、wav
            const aName = (file.name || '').toLowerCase();
            const aIsMp3 = file.type === 'audio/mpeg' || aName.endsWith('.mp3');
            const aIsWav = file.type === 'audio/wav' || aName.endsWith('.wav');
            if (!aIsMp3 && !aIsWav) {
                ElMessage.error('参考音频仅支持 mp3、wav 格式（Seedance 文档限制）');
                continue;
            }

            // Seedance 参考音频文档限制：<=15MB，时长 2-15s
            if (file.size > 15 * 1024 * 1024) {
                ElMessage.error('参考音频不能超过 15MB（Seedance 文档限制）');
                continue;
            }
            let audioDurationSeconds: number | null = null;
            try {
                const meta = await getMediaMetadataFromFile('audio', file);
                audioDurationSeconds = meta.durationSeconds;
                if (audioDurationSeconds < 2 || audioDurationSeconds > 15) {
                    ElMessage.error('参考音频时长需在 2-15 秒范围内（Seedance 文档限制）');
                    continue;
                }
            } catch {
                audioDurationSeconds = null;
            }

            const uploadRes: any = await uploadAudio(file);
            if (uploadRes.data && uploadRes.data.url) {
                const originalUrl: string = uploadRes.data.url;
                const nodeId = `audio_ref_node_${Date.now()}_${i}`;
                addNodes({
                    id: nodeId,
                    type: 'audioRef',
                    position: {
                        x: position.x + createdCount * 20,
                        y: position.y + createdCount * 20
                    },
                    data: {
                        url: originalUrl,
                        originalFilename: uploadRes.data.filename,
                        ...(audioDurationSeconds != null ? { durationSeconds: audioDurationSeconds } : {}),
                        sizeBytes: file.size,
                        mimeType: file.type,
                    }
                });
                createdCount++;
            }
        }

        if (createdCount > 0) {
            ElMessage.success(`成功创建 ${createdCount} 个媒体节点`);
            saveState();
            persistWorkflow().catch((error: any) => {
                console.error('关键操作保存失败（拖拽创建媒体节点）:', error);
            });
        }
    } catch (error: any) {
        console.error('上传失败:', error);
        ElMessage.error(error.message || '图片上传失败');
    }
};

// 执行「粘贴已复制节点」逻辑（可被 handlePaste 与 keydown 兜底调用）
const pasteCopiedNodes = () => {
    if (!copiedSelection.value || copiedSelection.value.nodes.length === 0) return;
    const timestamp = Date.now();
    const idMap: Record<string, string> = {};
    copiedSelection.value.nodes.forEach((node: any, index: number) => {
        idMap[node.id] = `${node.id}_copy_${timestamp}_${index}`;
    });
    let dx = 40;
    let dy = 40;
    const nodes = copiedSelection.value.nodes;
    if (nodes.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach((node: any) => {
            const x = node.position?.x ?? 0;
            const y = node.position?.y ?? 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        let targetX = centerX + 40;
        let targetY = centerY + 40;
        if (lastMousePosition.value) {
            const flowPos = screenToFlowCoordinate({
                x: lastMousePosition.value.x,
                y: lastMousePosition.value.y,
            });
            targetX = flowPos.x;
            targetY = flowPos.y;
        }
        dx = targetX - centerX;
        dy = targetY - centerY;
    }
    saveState();
    const newNodes = copiedSelection.value.nodes.map((node: any) => {
        const cloned = JSON.parse(JSON.stringify(node));
        cloned.id = idMap[node.id];
        cloned.position = {
            x: (cloned.position?.x ?? 0) + dx,
            y: (cloned.position?.y ?? 0) + dy,
        };
        cloned.selected = false;
        return cloned;
    });
    const newEdges = (copiedSelection.value.edges || []).map((edge: any, index: number) => {
        const cloned = JSON.parse(JSON.stringify(edge));
        cloned.id = `${edge.id}_copy_${timestamp}_${index}`;
        cloned.source = idMap[edge.source] || edge.source;
        cloned.target = idMap[edge.target] || edge.target;
        return cloned;
    });
    addNodes(newNodes);
    if (newEdges.length > 0) {
        addEdges(newEdges);
    }
    ElMessage.success(`已粘贴 ${newNodes.length} 个节点`);
};

// 处理粘贴事件：仅支持粘贴已复制的节点（单节点或多节点）
const handlePaste = (event: ClipboardEvent) => {
    const target = event.target as HTMLElement | null;
    const isInputElement = !!(
        target &&
        (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest('input, textarea, [contenteditable="true"]'))
    );
    if (isInputElement) return;

    if (copiedSelection.value && copiedSelection.value.nodes.length > 0) {
        event.preventDefault();
        didHandlePasteThisCycle.value = true;
        pasteCopiedNodes();
    }
};

// 画布鼠标移动：记录最后一次鼠标位置（用于粘贴图片节点定位）
const handleCanvasMouseMove = (event: MouseEvent) => {
    lastMousePosition.value = {
        x: event.clientX,
        y: event.clientY,
    };
};

// 右键菜单处理
const handlePaneContextMenu = (event: any) => {
    event.event.preventDefault();
    contextMenuPosition.value = {
        x: event.event.clientX,
        y: event.event.clientY
    };
    contextMenuVisible.value = true;
};

// 画布兜底右键菜单（当 VueFlow 的 pane-contextmenu 未触发时）
const handleCanvasContextMenu = (event: MouseEvent) => {
    // 若右键发生在节点/菜单上，不处理（避免抢占）
    const target = event.target as HTMLElement;
    if (target.closest('.vue-flow__node') || target.closest('.context-menu')) return;

    contextMenuPosition.value = { x: event.clientX, y: event.clientY };
    contextMenuVisible.value = true;
};

// 插入节点函数（右键添加时放在右键位置，允许重合）
const insertPromptNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `prompt_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'prompt',
        position,
        data: { text: '' }
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入提示词节点）:', error);
    });
};

const insertImageNode = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;

    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!isImageFile(file)) {
            ElMessage.warning('不支持的图片格式，请上传 JPG、PNG、GIF、WebP 等图片');
            return;
        }

        const position = screenToFlowCoordinate({
            x: contextMenuPosition.value.x,
            y: contextMenuPosition.value.y
        });

        try {
            const uploadRes: any = await uploadImage(file);
            if (uploadRes.data && uploadRes.data.url) {
                const originalUrl: string = uploadRes.data.url;
                const imageUrl = originalUrl.startsWith('http')
                    ? originalUrl
                    : getUploadUrl(originalUrl);
                const imageKey: string = uploadRes.data.filename || originalUrl;
                const alias = getOrCreateImageAlias(imageKey);

                const nodeId = `image_node_${Date.now()}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position,
                    data: {
                        imageUrl,
                        originalImageUrl: originalUrl,
                        originalFilename: uploadRes.data.filename,
                        imageAlias: alias,
                        imageKey,
                    }
                });
                ElMessage.success('已插入图片节点');

                // 保存状态到撤销栈并立即持久化
                saveState();
                persistWorkflow().catch((error: any) => {
                    console.error('关键操作保存失败（插入图片节点）:', error);
                });
            } else {
                ElMessage.error('图片上传失败：返回数据异常');
            }
        } catch (error: any) {
            console.error('上传失败:', error);
            ElMessage.error(error.message || '图片上传失败');
        }
    };

    input.click();
};

const insertDreamNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `dream_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'dream',
        position,
        data: {}
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入生图节点）:', error);
    });
};

const insertVideoNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `video_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'video',
        position,
        data: {}
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入视频节点）:', error);
    });
};

const insertLayerSeparationNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `layer_separation_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'layerSeparation',
        position,
        data: {}
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入图层分离节点）:', error);
    });
};

const insertVideoRefNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `video_ref_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'videoRef',
        position,
        data: {
            urls: [],
        }
    });

    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入视频参考节点）:', error);
    });
};

const insertAudioRefNode = () => {
    const position = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });

    const nodeId = `audio_ref_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'audioRef',
        position,
        data: {
            urls: [],
        }
    });

    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（插入音频参考节点）:', error);
    });
};


const handleAddGroup = () => {
    ElMessage.info('添加组功能待实现');
};

// 左侧工具栏：在画布中心附近添加提示词节点
const addPromptNodeFromToolbar = () => {
    const position = calculateOptimalPosition('prompt');

    const nodeId = `prompt_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'prompt',
        position,
        data: { text: '' },
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加提示词节点）:', error);
    });
};

// 左侧工具栏：添加图片节点（上传图片）
const addImageNodeFromToolbar = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;

    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!isImageFile(file)) {
            ElMessage.warning('不支持的图片格式，请上传 JPG、PNG、GIF、WebP 等图片');
            return;
        }

        const position = calculateOptimalPosition('image');

        try {
            const uploadRes: any = await uploadImage(file);
            if (uploadRes.data && uploadRes.data.url) {
                const originalUrl: string = uploadRes.data.url;
                const imageUrl = originalUrl.startsWith('http')
                    ? originalUrl
                    : getUploadUrl(originalUrl);
                const imageKey: string = uploadRes.data.filename || originalUrl;
                const alias = getOrCreateImageAlias(imageKey);

                const nodeId = `image_node_${Date.now()}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position,
                    data: {
                        imageUrl,
                        originalImageUrl: originalUrl,
                        originalFilename: uploadRes.data.filename,
                        imageAlias: alias,
                        imageKey,
                    },
                });
                ElMessage.success('已添加图片节点');

                // 保存状态到撤销栈并立即持久化
                saveState();
                persistWorkflow().catch((error: any) => {
                    console.error('关键操作保存失败（添加图片节点）:', error);
                });
            } else {
                ElMessage.error('图片上传失败：返回数据异常');
            }
        } catch (error: any) {
            console.error('上传失败:', error);
            ElMessage.error(error.message || '图片上传失败');
        }
    };

    input.click();
};

// 连接结束处理（用于拖拽虚线到空白处）
const handleConnectEnd = (event: any) => {
    const mouseEvent: MouseEvent | undefined = event?.event ?? event;
    if (!mouseEvent) return;

    // 尝试从 connect-start / connect-end 多处兜底获取 source 信息
    const sourceId =
        connectStartInfo.value?.source ??
        event?.source ??
        event?.nodeId ??
        event?.sourceNode?.id;
    const sourceHandle =
        connectStartInfo.value?.sourceHandle ??
        event?.sourceHandle ??
        event?.handleId;
    if (!sourceId) return;

    const sourceNode = findNode(sourceId);
    if (!sourceNode) {
        connectStartInfo.value = null;
        return;
    }

    // 清理 connectStartInfo（无论是否弹菜单，都避免下次串场）
    connectStartInfo.value = null;

    // 如果本次真的连接成功（触发了 onConnect），不要弹菜单
    if (didConnect.value) {
        didConnect.value = false;
        return;
    }
    didConnect.value = false;

    // 仅图片/提示词/视频节点：从右侧拖线到空白处，弹出“图片/视频”选择
    if (sourceNode.type !== 'image' && sourceNode.type !== 'prompt' && sourceNode.type !== 'video') {
        return;
    }

    // 仅从右侧输出 handle 拖出时才弹（避免误触）
    const allowedSourceHandles = new Set(['image-source', 'prompt-source', 'source']);
    if (sourceHandle && !allowedSourceHandles.has(sourceHandle)) return;

    pendingConnection.value = {
        source: sourceId,
        sourceHandle: sourceHandle,
        position: screenToFlowCoordinate({
            x: mouseEvent.clientX,
            y: mouseEvent.clientY
        })
    };

    connectionMenuPosition.value = {
        x: mouseEvent.clientX,
        y: mouseEvent.clientY
    };
    connectionMenuVisible.value = true;
};

// 连接到图片节点
const handleConnectToImage = () => {
    if (!pendingConnection.value) return;

    const sourceNode = findNode(pendingConnection.value.source);
    let position: { x: number; y: number };

    // 优先使用鼠标位置（连接线末端的位置）
    const mousePosition = pendingConnection.value.position;
    
    // 检查鼠标位置是否可用（简单碰撞检测）
    const dimensions = NODE_DIMENSIONS['dream'] || { width: 300, height: 400 };
    const checkCollisionAtPosition = (x: number, y: number): boolean => {
        const newNodeRect = {
            left: x,
            top: y,
            right: x + dimensions.width,
            bottom: y + dimensions.height
        };

        for (const node of getNodes.value) {
            if (node.id === pendingConnection.value!.source) continue; // 跳过源节点
            const nodeDim = NODE_DIMENSIONS[node.type || 'dream'] || { width: 300, height: 400 };
            const nodeRect = {
                left: node.position.x,
                top: node.position.y,
                right: node.position.x + nodeDim.width,
                bottom: node.position.y + nodeDim.height
            };

            const padding = 20;
            if (
                newNodeRect.left < nodeRect.right + padding &&
                newNodeRect.right > nodeRect.left - padding &&
                newNodeRect.top < nodeRect.bottom + padding &&
                newNodeRect.bottom > nodeRect.top - padding
            ) {
                return true; // 发生碰撞
            }
        }
        return false; // 无碰撞
    };

    // 如果鼠标位置可用，直接使用；否则使用源节点右侧的位置
    if (!checkCollisionAtPosition(mousePosition.x, mousePosition.y)) {
        position = mousePosition;
    } else if (sourceNode) {
        // 使用源节点右侧的位置
        const sourceNodeDim = NODE_DIMENSIONS[sourceNode.type || 'dream'] || { width: 300, height: 400 };
        position = {
            x: sourceNode.position.x + sourceNodeDim.width + 100,
            y: sourceNode.position.y
        };
        // 如果源节点右侧位置也有碰撞，使用 calculateOptimalPosition
        if (checkCollisionAtPosition(position.x, position.y)) {
            position = calculateOptimalPosition('dream', mousePosition);
        }
    } else {
        // 回退到 calculateOptimalPosition
        position = calculateOptimalPosition('dream', mousePosition);
    }

    const nodeId = `dream_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'dream',
        position,
        data: {}
    });

    // 建立连接
    if (sourceNode) {
        const sourceHandle = pendingConnection.value.sourceHandle || 'source';
        const targetHandle = 'target';

        addEdges({
            id: `edge-${pendingConnection.value.source}-${nodeId}-${Date.now()}`,
            source: pendingConnection.value.source,
            target: nodeId,
            sourceHandle: sourceHandle,
            targetHandle: targetHandle,
            type: 'default',
            animated: true
        });
    }

    pendingConnection.value = null;
    ElMessage.success('已创建生图节点并建立连接');

    // 保存状态到撤销栈
    saveState();
};

// 连接到视频节点
const handleConnectToVideo = () => {
    if (!pendingConnection.value) return;

    const sourceNode = findNode(pendingConnection.value.source);
    let position: { x: number; y: number };

    // 优先使用鼠标位置（连接线末端的位置）
    const mousePosition = pendingConnection.value.position;
    
    // 检查鼠标位置是否可用（简单碰撞检测）
    const dimensions = NODE_DIMENSIONS['video'] || { width: 300, height: 400 };
    const checkCollisionAtPosition = (x: number, y: number): boolean => {
        const newNodeRect = {
            left: x,
            top: y,
            right: x + dimensions.width,
            bottom: y + dimensions.height
        };

        for (const node of getNodes.value) {
            if (node.id === pendingConnection.value!.source) continue; // 跳过源节点
            const nodeDim = NODE_DIMENSIONS[node.type || 'video'] || { width: 300, height: 400 };
            const nodeRect = {
                left: node.position.x,
                top: node.position.y,
                right: node.position.x + nodeDim.width,
                bottom: node.position.y + nodeDim.height
            };

            const padding = 20;
            if (
                newNodeRect.left < nodeRect.right + padding &&
                newNodeRect.right > nodeRect.left - padding &&
                newNodeRect.top < nodeRect.bottom + padding &&
                newNodeRect.bottom > nodeRect.top - padding
            ) {
                return true; // 发生碰撞
            }
        }
        return false; // 无碰撞
    };

    // 如果鼠标位置可用，直接使用；否则使用源节点右侧的位置
    if (!checkCollisionAtPosition(mousePosition.x, mousePosition.y)) {
        position = mousePosition;
    } else if (sourceNode) {
        // 使用源节点右侧的位置
        const sourceNodeDim = NODE_DIMENSIONS[sourceNode.type || 'video'] || { width: 300, height: 400 };
        position = {
            x: sourceNode.position.x + sourceNodeDim.width + 100,
            y: sourceNode.position.y
        };
        // 如果源节点右侧位置也有碰撞，使用 calculateOptimalPosition
        if (checkCollisionAtPosition(position.x, position.y)) {
            position = calculateOptimalPosition('video', mousePosition);
        }
    } else {
        // 回退到 calculateOptimalPosition
        position = calculateOptimalPosition('video', mousePosition);
    }

    const nodeId = `video_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'video',
        position,
        data: {}
    });

    // 建立连接
    if (sourceNode) {
        addEdges({
            id: `edge-${pendingConnection.value.source}-${nodeId}-${Date.now()}`,
            source: pendingConnection.value.source,
            target: nodeId,
            sourceHandle: pendingConnection.value.sourceHandle || 'source',
            targetHandle: 'target',
            type: 'default',
            animated: true
        });
    }

    pendingConnection.value = null;
    ElMessage.success('已创建视频节点并建立连接');

    // 保存状态到撤销栈
    saveState();
};

// 添加新节点逻辑
const addNode = () => {
    const position = calculateOptimalPosition('dream');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'dream',
        position,
        data: { label: `节点 ${id}` },
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加生图节点）:', error);
    });
};

const addUpscaleNode = () => {
    const position = calculateOptimalPosition('upscale');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'upscale',
        position,
        data: {},
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加放大节点）:', error);
    });
};

const addExtendNode = () => {
    const position = calculateOptimalPosition('extend');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'extend',
        position,
        data: {},
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加扩展节点）:', error);
    });
};



const addLayerSeparationNode = () => {
    const position = calculateOptimalPosition('layerSeparation');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'layerSeparation',
        position,
        data: {},
    });

    // 保存状态到撤销栈并立即持久化
    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加图层分离节点）:', error);
    });
};

const addVideoRefNode = () => {
    const position = calculateOptimalPosition('videoRef');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'videoRef',
        position,
        data: {
            urls: [],
        },
    });

    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加视频参考节点）:', error);
    });
};

const addAudioRefNode = () => {
    const position = calculateOptimalPosition('audioRef');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'audioRef',
        position,
        data: {
            urls: [],
        },
    });

    saveState();
    persistWorkflow().catch((error: any) => {
        console.error('关键操作保存失败（添加音频参考节点）:', error);
    });
};

// 保存模板：进入自己的项目则覆盖，进入别人的项目则另存为自己的
const handleSaveTemplate = async () => {
    if (!saveForm.value.name.trim()) {
        ElMessage.warning('请输入模板名称');
        return;
    }

    if (!saveForm.value.category) {
        ElMessage.warning('请选择分类');
        return;
    }

    const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
    const isOwn = currentTemplateId.value != null && templateOwnerId.value != null && myId != null && templateOwnerId.value === myId;

    saving.value = true;
    try {
        const workflowData = {
            nodes: getNodes.value,
            edges: getEdges.value,
            imageAliasCounter: imageAliasCounter.value,
            imageAliasMap: imageAliasMap.value,
        };
        const payload: {
            name: string;
            description: string;
            workflowData: WorkflowDTO;
            isPublic: boolean;
            coverImage: string;
            category: string;
            isTemp?: boolean;
            sourceTemplateId?: number;
        } = {
            name: saveForm.value.name,
            description: saveForm.value.description,
            workflowData,
            isPublic: saveForm.value.isPublic,
            coverImage: saveForm.value.coverImage,
            category: saveForm.value.category,
            // 手动保存对话框一般用于“正式项目”，因此这里显式标记为非临时
            isTemp: false
        };

        if (isOwn) {
            await updateTemplate(currentTemplateId.value!, payload);
            ElMessage.success('模板已更新');
        } else {
            await saveTemplate(payload);
            ElMessage.success('已保存为新项目');
        }

        showSaveDialog.value = false;
        saveForm.value = { name: '', description: '', isPublic: false, coverImage: '', category: '' };
        loadTemplates();
    } catch (error: any) {
        ElMessage.error(error.message || '保存失败');
    } finally {
        saving.value = false;
    }
};

// 加载分类列表
const loadCategories = async () => {
    try {
        const res: any = await getActiveCategories();
        categories.value = res.data || [];
    } catch (error: any) {
        console.error('加载分类列表失败:', error);
    }
};

// 加载模板列表
const loadTemplates = async () => {
    try {
        const res: any = await getTemplates();
        templates.value = res.data || [];
    } catch (error: any) {
        ElMessage.error(error.message || '加载模板列表失败');
    }
};

// 加载模板
const handleLoadTemplate = async (template: WorkflowTemplate) => {
    try {
        const res: any = await getTemplate(template.id);
        const workflowData = res.data.workflow_data;

        if (workflowData.nodes && workflowData.edges) {
            setNodes(workflowData.nodes);
            setEdges(workflowData.edges);
            restoreImageAliasStateFromWorkflow(workflowData);
            ElMessage.success('模板加载成功');
            showLoadDialog.value = false;
            clearUndoRedoAndPending();
        } else {
            ElMessage.warning('模板数据格式不正确');
        }
    } catch (error: any) {
        ElMessage.error(error.message || '加载模板失败');
    }
};

// 删除模板
const handleDeleteTemplate = async (templateId: number) => {
    try {
        await ElMessageBox.confirm('确定要删除此模板吗？', '提示', { type: 'warning' });
        await deleteTemplate(templateId);
        ElMessage.success('模板删除成功');
        loadTemplates();
    } catch (error: any) {
        if (error !== 'cancel') {
            ElMessage.error(error.message || '删除失败');
        }
    }
};

// 打开加载对话框时加载模板列表
const showLoadDialogHandler = () => {
    showLoadDialog.value = true;
    loadTemplates();
};

// 加载历史记录列表（仅当前项目）
const loadHistories = async () => {
    try {
        const res: any = await getHistoryList(20, currentTemplateId.value != null ? currentTemplateId.value : undefined);
        histories.value = res.data || [];
    } catch (error: any) {
        ElMessage.error(error.message || '加载历史记录失败');
    }
};

// 加载历史记录
const handleLoadHistory = async (history: WorkflowHistory) => {
    try {
        const res: any = await getHistory(history.id);
        const workflowData = res.data.workflow_data;
        const templateIdFromHistory = res.data?.template_id as number | undefined;

        if (workflowData.nodes && workflowData.edges) {
            setNodes(workflowData.nodes);
            setEdges(workflowData.edges);
            restoreImageAliasStateFromWorkflow(workflowData);
            if (templateIdFromHistory != null) {
                currentTemplateId.value = templateIdFromHistory;
                const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
                templateOwnerId.value = myId;
            }
            // 记住当前编辑的是哪条历史记录，并写入本地存储，便于刷新后自动恢复
            currentHistoryId.value = history.id;
            window.localStorage.setItem('workflow:lastHistoryId', String(history.id));
            ElMessage.success('历史记录恢复成功');
            showHistoryDialog.value = false;
            clearUndoRedoAndPending();
        } else {
            ElMessage.warning('历史记录数据格式不正确');
        }
    } catch (error: any) {
        ElMessage.error(error.message || '恢复历史记录失败');
    }
};

// 删除历史记录
const handleDeleteHistory = async (historyId: number) => {
    try {
        await ElMessageBox.confirm('确定要删除此历史记录吗？', '提示', { type: 'warning' });
        await deleteHistoryApi(historyId);
        ElMessage.success('历史记录删除成功');
        loadHistories();
    } catch (error: any) {
        if (error !== 'cancel') {
            ElMessage.error(error.message || '删除失败');
        }
    }
};

// 自动保存工作流（每30秒）
const startAutoSave = () => {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }

    autoSaveTimer = setInterval(async () => {
        try {
            if (!hasPendingChanges.value) {
                return;
            }
            const ok = await persistWorkflow();
            if (ok) {
                console.log('工作流自动保存成功');
            }
        } catch (error: any) {
            console.error('自动保存失败:', error);
        }
    }, 30000); // 30秒
};

// 打开历史记录对话框
const showHistoryDialogHandler = () => {
    showHistoryDialog.value = true;
    loadHistories();
};

// 快捷键处理
const handleKeyDown = (event: KeyboardEvent) => {
    // 检查是否在输入框、文本域或可编辑元素中
    const target = event.target as HTMLElement;
    const isInputElement = target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('input, textarea, [contenteditable="true"]');

    // Space: 按住空格启用画布拖拽（仅在非输入状态）
    if (event.code === 'Space' && !isInputElement) {
        event.preventDefault(); // 防止页面滚动
        isSpacePressed.value = true;
    }

    // Ctrl+S 或 Cmd+S: 保存模板
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (getNodes.value.length > 0) {
            loadCategories();
            showSaveDialog.value = true;
        } else {
            ElMessage.warning('当前没有工作流内容可保存');
        }
    }

    // Delete 或 Backspace: 删除选中的节点（仅在非输入状态下）
    if ((event.key === 'Delete' || event.key === 'Backspace') && !isInputElement) {
        const selectedNodes = getNodes.value.filter(node => node.selected);
        if (selectedNodes.length > 0) {
            event.preventDefault();

            // 先把「删除前」的状态保存到撤销栈，方便 Ctrl+Z 恢复
            saveState();

            const nodeIds = selectedNodes.map(node => node.id);
            removeNodes(nodeIds);
            ElMessage.success(`已删除 ${selectedNodes.length} 个节点`);

            // 删除节点视为关键操作，立即尝试持久化
            persistWorkflow().catch((error: any) => {
                console.error('关键操作保存失败（删除节点）:', error);
            });
        }
    }

    // Ctrl+C / Cmd+C: 复制当前选中的节点（单节点或多节点）及它们之间的连线
    if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !isInputElement) {
        const selectedNodes = getNodes.value.filter(node => node.selected);
        if (selectedNodes.length > 0) {
            const selectedIds = new Set(selectedNodes.map(node => node.id));
            const selectedEdges = getEdges.value.filter(
                edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)
            );
            copiedSelection.value = {
                nodes: JSON.parse(JSON.stringify(selectedNodes)),
                edges: JSON.parse(JSON.stringify(selectedEdges)),
            };
            ElMessage.success(`已复制 ${selectedNodes.length} 个节点`);
        }
    }

    // 快捷键：T - 插入提示词节点
    if (event.key === 't' && !isInputElement) {
        event.preventDefault();
        insertPromptNode();
    }

    // 快捷键：I - 插入图片节点
    if (event.key === 'i' && !isInputElement) {
        event.preventDefault();
        insertImageNode();
    }

    // 快捷键：G - 插入生图节点
    if (event.key === 'g' && !isInputElement) {
        event.preventDefault();
        insertDreamNode();
    }

// 快捷键：Ctrl+B / Cmd+B - 插入视频生成节点
    if ((event.ctrlKey || event.metaKey) && event.key === 'b' && !isInputElement) {
        event.preventDefault();
        insertVideoNode();
    }

    // 快捷键：L - 插入图层分离节点
    if (event.key === 'l' && !isInputElement) {
        event.preventDefault();
        insertLayerSeparationNode();
    }

    // Ctrl+V：节点粘贴由 paste 事件优先处理；若 paste 未触发（如画布焦点问题），则延迟兜底执行节点粘贴
    if ((event.ctrlKey || event.metaKey) && event.key === 'v' && !isInputElement) {
        if (copiedSelection.value && copiedSelection.value.nodes.length > 0) {
            setTimeout(() => {
                if (!didHandlePasteThisCycle.value) {
                    pasteCopiedNodes();
                }
                didHandlePasteThisCycle.value = false;
            }, 80);
        }
    }

    // Ctrl+Z 或 Cmd+Z: 撤销
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
    }

    // Ctrl+Y 或 Cmd+Shift+Z: 重做
    if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
    }
};

const handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
        event.preventDefault();
        isSpacePressed.value = false;
    }
};

// 路由离开钩子：无论通过哪种方式离开编辑器页面，都尝试保存一次
onBeforeRouteLeave(async (_to, _from, next) => {
    try {
        await saveCurrentWorkflowBeforeLeave();
    } catch (error: any) {
        console.error('离开编辑器前保存失败:', error);
        // 不阻塞导航，只提示错误（控制台），用户可从历史记录恢复
    } finally {
        next();
    }
});

onMounted(async () => {
    userStore.fetchCredits();
    // 启动自动保存
    startAutoSave();

    // 绑定快捷键
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste, true);

    // 处理URL参数
    const query = route.query;

    // 如果有 historyId 参数，加载自动保存的历史（后续保存将覆盖此条）
    if (query.historyId) {
        try {
            const historyId = parseInt(query.historyId as string);
            if (!isNaN(historyId)) {
                currentHistoryId.value = historyId;
                const res: any = await getHistory(historyId);
                const workflowData = res.data?.workflow_data;
                const templateIdFromHistory = res.data?.template_id as number | undefined;
                if (workflowData?.nodes && workflowData?.edges) {
                    setNodes(workflowData.nodes);
                    setEdges(workflowData.edges);
                    clearUndoRedoAndPending();
                    window.localStorage.setItem('workflow:lastHistoryId', String(historyId));
                    if (templateIdFromHistory != null) {
                        currentTemplateId.value = templateIdFromHistory;
                        const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
                        templateOwnerId.value = myId;
                    }
                    ElMessage.success('已恢复自动保存的工作流');
                } else {
                    ElMessage.warning('该历史记录数据不完整');
                }
                return;
            }
        } catch (error: any) {
            console.error('加载历史失败:', error);
        }
    }

    // 如果有id参数，加载模板（记下是否为自己的项目，保存时覆盖或另存）
    if (query.id) {
        try {
            const templateId = parseInt(query.id as string);
            if (!isNaN(templateId)) {
                const res: any = await getTemplate(templateId);
                const data = res.data;
                const workflowData = data.workflow_data;
                const ownerId = data.user_id != null ? Number(data.user_id) : null;
                const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
                if (ownerId != null && myId != null && ownerId === myId) {
                    currentTemplateId.value = templateId;
                    templateOwnerId.value = ownerId;
                } else {
                    currentTemplateId.value = null;
                    templateOwnerId.value = null;
                    // 从他人公开模板进入编辑时，后续创建的临时项目记录来源模板 ID
                    sourceTemplateIdForTemp.value = templateId;
                }

                if (workflowData?.nodes && workflowData?.edges) {
                    setNodes(workflowData.nodes);
                    setEdges(workflowData.edges);
                    clearUndoRedoAndPending();
                    ElMessage.success('模板加载成功');
                } else {
                    ElMessage.warning('模板数据格式不正确');
                }
                return; // 如果加载了模板，就不处理prompt和model参数了
            }
        } catch (error: any) {
            console.error('加载模板失败:', error);
            // 如果加载失败，继续处理其他参数
        }
    }

    // 如果既没有通过 URL 指定 historyId，也没有指定模板 id，
    // 且不是显式“新建项目”(new=1)，则尝试从本地存储中恢复最近一次自动保存的版本
    if (!query.historyId && !query.id && !query.new) {
        const lastIdRaw = window.localStorage.getItem('workflow:lastHistoryId');
        const lastId = lastIdRaw ? parseInt(lastIdRaw, 10) : NaN;
        if (!Number.isNaN(lastId)) {
            try {
                const res: any = await getHistory(lastId);
                const workflowData = res.data?.workflow_data;
                const templateIdFromHistory = res.data?.template_id as number | undefined;
                if (workflowData?.nodes && workflowData?.edges) {
                    currentHistoryId.value = lastId;
                    setNodes(workflowData.nodes);
                    setEdges(workflowData.edges);
                    clearUndoRedoAndPending();
                    if (templateIdFromHistory != null) {
                        currentTemplateId.value = templateIdFromHistory;
                        const myId = userStore.userInfo?.id != null ? Number(userStore.userInfo.id) : null;
                        templateOwnerId.value = myId;
                    }
                    ElMessage.success('已恢复最近一次自动保存的工作流');
                }
            } catch (error: any) {
                console.error('自动恢复最近历史失败:', error);
            }
        }
    }

    // 如果有prompt参数或imageUrls参数，创建节点并设置提示词和图片
    if (query.prompt || query.imageUrls || query.imageUrl) {
        const promptText = (query.prompt as string) || '';
        const model = (query.model as string) || 'dream';

        // 处理图片URL（支持多个，逗号分隔）
        let imageUrls: string[] = [];
        if (query.imageUrls) {
            imageUrls = (query.imageUrls as string).split(',').filter(url => url.trim());
        } else if (query.imageUrl) {
            // 兼容旧的单个imageUrl参数
            imageUrls = [(query.imageUrl as string)];
        }

        // 清除初始节点
        setNodes([]);
        setEdges([]);

        // 基准坐标：图片列在左侧，生图节点居中，提示词节点在左下角
        const baseX = 60;
        const baseY = 80;
        const imageNodeHeight = NODE_DIMENSIONS.image?.height || 300;
        // 再次压缩纵向和横向间距，让 4~5 张图也能尽量一屏展示
        const verticalSpacing = imageNodeHeight + 8; // 更紧凑的纵向间距
        const horizontalSpacing = 320; // 更近的水平间距
        const imageNodeIds: string[] = [];
        let promptNodeId: string | null = null;
        let dreamNodeId: string | null = null;

        // 创建图片节点（在左侧一列，垂直排列）
        imageUrls.forEach((imageUrl, index) => {
            const fullImageUrl = imageUrl.startsWith('http')
                ? imageUrl
                : getUploadUrl(imageUrl);

            const nodeId = `image_node_${Date.now()}_${index}`;
            imageNodeIds.push(nodeId);

            addNodes({
                id: nodeId,
                type: 'image',
                position: {
                    x: baseX,
                    y: baseY + index * verticalSpacing
                },
                data: {
                    imageUrl: fullImageUrl,
                    originalImageUrl: imageUrl
                }
            });
        });

        // 计算所有图片节点的总高度和中心位置，用于垂直居中生图节点
        let centerY = baseY;
        if (imageUrls.length > 0) {
            const totalHeight = imageUrls.length * imageNodeHeight + (imageUrls.length - 1) * (verticalSpacing - imageNodeHeight);
            const firstNodeTop = baseY;
            centerY = firstNodeTop + totalHeight / 2;
        }

        // 创建提示词节点（放在左侧底部一行，而不是中间一列）
        if (promptText.trim()) {
            promptNodeId = `prompt_node_${Date.now()}`;

            addNodes({
                id: promptNodeId,
                type: 'prompt',
                position: {
                    x: baseX,
                    // 放在图片列下方一行
                    y: baseY + imageUrls.length * verticalSpacing + VERTICAL_PADDING
                },
                data: {
                    text: promptText.trim()
                }
            });
        }

        // 创建生图节点（在图片列右侧，垂直方向与图片整体居中对齐）
        dreamNodeId = `dream_node_${Date.now()}`;
        const nodeData: any = {
            label: '生图节点',
        };

        // 根据model设置apiType
        if (model === 'nano') {
            nodeData.apiType = 'nano';
        } else {
            nodeData.apiType = 'dream';
        }

        addNodes({
            id: dreamNodeId,
            type: 'dream',
            position: {
                x: baseX + horizontalSpacing,
                y: centerY - (NODE_DIMENSIONS.dream?.height || 500) / 2
            },
            data: nodeData
        });

        // 创建连接：所有图片节点连接到生图节点
        imageNodeIds.forEach(imageNodeId => {
            addEdges({
                id: `edge_${imageNodeId}_to_${dreamNodeId}`,
                source: imageNodeId,
                target: dreamNodeId,
                sourceHandle: 'image-source',
                targetHandle: 'target'
            });
        });

        // 创建连接：提示词节点连接到生图节点
        if (promptNodeId) {
            addEdges({
                id: `edge_${promptNodeId}_to_${dreamNodeId}`,
                source: promptNodeId,
                target: dreamNodeId,
                sourceHandle: 'prompt-source',
                targetHandle: 'target'
            });
        }

        // 自动适配到一屏内
        await nextTick();
        try {
            // 减小 padding，让内容更“贴边”一点，尽量塞进一屏
            fitView({ padding: 0.08 });
        } catch (e) {
            console.warn('fitView 失败:', e);
        }

        ElMessage.success(`已创建 ${imageUrls.length} 个图片节点${promptText.trim() ? '、1 个提示词节点' : ''}和 1 个生图节点，并已自动连接`);
        return;
    }

    // 无 URL 参数时：视为新建/进入新项目，使用默认初始节点（一个提示词节点），不恢复上次工作流
});

// 组件卸载时清理定时器和事件监听
onUnmounted(() => {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('paste', handlePaste, true);
});
</script>

<style scoped>
.workflow-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
}

.back-button-float {
    position: fixed;
    top: 10px;
    left: 12px;
    z-index: 30;
    padding: 6px 10px;
    font-size: 14px;
    color: var(--text-muted);
}

.back-button-float:hover {
    color: var(--color-primary);
}

.workflow-header-float {
    position: fixed;
    top: 10px;
    right: 16px;
    z-index: 30;
}

.workflow-save-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    justify-content: flex-end;
}

.workflow-save-time {
    font-size: 12px;
    color: var(--text-muted);
}

.workflow-save-time--pending {
    color: var(--color-warning);
}

.workflow-save-warning {
    font-size: 12px;
    color: #ff4d4f;
    max-width: 260px;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
}

.workflow-user-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: rgba(39, 40, 47, 0.95);
    border-radius: 20px;
    border: 1px solid var(--app-border-strong);
}

.workflow-avatar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    font-weight: 600;
}

.workflow-user-details {
    display: flex;
    flex-direction: column;
    gap: 0;
}

.workflow-username {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-soft);
}

.workflow-credits {
    font-size: 11px;
    color: var(--text-subtle);
}

.canvas-wrapper {
    flex: 1;
    background: var(--app-bg);
    overflow: hidden;
    min-height: 0;
    position: relative;
}

.canvas-wrapper :deep(.vue-flow__node.selected) {
    box-shadow: 0 0 0 2px var(--color-primary), 0 0 12px rgba(37, 99, 235, 0.75);
    border-radius: 8px;
}

.canvas-wrapper :deep(.vue-flow__selection) {
    border: 1px dashed rgba(37, 99, 235, 0.9);
    background-color: var(--color-primary-soft);
}

/* 全局下拉菜单暗色主题（作用于工作流内所有 Element Plus 下拉） */
.workflow-container :deep(.el-select-dropdown) {
    background-color: #252525;
    border: 1px solid #404040;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.65);
}

.workflow-container :deep(.el-select-dropdown__item) {
    color: #b0b0b0;
}

.workflow-container :deep(.el-select-dropdown__item.is-selected) {
    color: #ffffff;
    background-color: #333333;
}

.workflow-container :deep(.el-select-dropdown__item.hover),
.workflow-container :deep(.el-select-dropdown__item:hover) {
    background-color: #333333;
}

/* 工作流内滚动条统一深色样式 */
.workflow-container :deep(*::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
}

.workflow-container :deep(*::-webkit-scrollbar-track) {
    background: #151515;
}

.workflow-container :deep(*::-webkit-scrollbar-thumb) {
    background-color: #555555;
    border-radius: 3px;
}

.workflow-container :deep(*::-webkit-scrollbar-thumb:hover) {
    background-color: #777777;
}

/* 右下角小地图预览：背景与节点色 */
.canvas-wrapper :deep(.vue-flow__minimap) {
    background-color: #212228 !important;
}
.canvas-wrapper :deep(.vue-flow__minimap svg) {
    background-color: #212228;
}
.canvas-wrapper :deep(.vue-flow__minimap .vue-flow__minimap-mask) {
    fill: #212228;
}

.side-toolbar {
    position: absolute;
    top: 50%;
    left: 16px;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    z-index: 20;
    padding: 16px 8px;
    width: 64px;
    background: #27282f;
    border-radius: 20px;
    border: 1px solid #404040;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.side-toolbar :deep(.el-button) {
    box-shadow: none;
    margin-left: 0 !important;
    /* 覆盖 Element Plus 默认的相邻按钮左间距，避免水平偏移 */
}

.side-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}

.side-divider {
    width: 36px;
    height: 1px;
    background-color: #e5e5e5;
    margin: 4px 0;
}

.side-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid #3b3d48;
    background-color: #393c45;
    color: #e0e0e0;
}
</style>