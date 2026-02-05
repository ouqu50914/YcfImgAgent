<template>
    <div class="workflow-container">
        <!-- 悬浮返回按钮 -->
        <el-button 
            text 
            @click="handleGoBack"
            class="back-button-float"
        >
            <el-icon><ArrowLeft /></el-icon>
            返回
        </el-button>

        <div 
            class="canvas-wrapper"
            @dragover.prevent="handleDragOver"
            @drop.prevent="handleDrop"
            @contextmenu.prevent="handleCanvasContextMenu"
        >
            <!-- 左侧功能图标栏 -->
            <div class="side-toolbar">
                <div class="side-group side-group-primary">
                    <el-tooltip content="添加提示词节点" placement="right">
                        <el-button circle class="side-btn" @click="addPromptNodeFromToolbar">
                            <el-icon><EditPen /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加图片节点" placement="right">
                        <el-button circle class="side-btn" @click="addImageNodeFromToolbar">
                            <el-icon><Picture /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加生图节点" placement="right">
                        <el-button circle class="side-btn" @click="addNode">
                            <el-icon><MagicStick /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加放大节点" placement="right">
                        <el-button circle class="side-btn" @click="addUpscaleNode">
                            <el-icon><ZoomIn /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加扩展节点" placement="right">
                        <el-button circle class="side-btn" @click="addExtendNode">
                            <el-icon><FullScreen /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加拆分节点" placement="right">
                        <el-button circle class="side-btn" @click="addSplitNode">
                            <el-icon><KnifeFork /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="添加图层分离节点" placement="right">
                        <el-button circle class="side-btn" @click="addLayerSeparationNode">
                            <el-icon><Grid /></el-icon>
                        </el-button>
                    </el-tooltip>
                </div>

                <div class="side-divider"></div>

                <div class="side-group side-group-secondary">
                    <el-tooltip content="保存模板" placement="right">
                        <el-button circle class="side-btn" @click="() => { loadCategories(); showSaveDialog = true; }">
                            <el-icon><Collection /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="加载模板" placement="right">
                        <el-button circle class="side-btn" @click="showLoadDialogHandler">
                            <el-icon><FolderOpened /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="历史记录" placement="right">
                        <el-button circle class="side-btn" @click="showHistoryDialogHandler">
                            <el-icon><Clock /></el-icon>
                        </el-button>
                    </el-tooltip>
                </div>
                
                <div class="side-divider"></div>
                
                <div class="side-group side-group-secondary">
                    <el-tooltip content="撤销 (Ctrl+Z)" placement="right">
                        <el-button 
                            circle 
                            class="side-btn" 
                            @click="undo"
                            :disabled="undoStack.length === 0"
                        >
                            <el-icon><RefreshLeft /></el-icon>
                        </el-button>
                    </el-tooltip>
                    <el-tooltip content="重做 (Ctrl+Y)" placement="right">
                        <el-button 
                            circle 
                            class="side-btn" 
                            @click="redo"
                            :disabled="redoStack.length === 0"
                        >
                            <el-icon><RefreshRight /></el-icon>
                        </el-button>
                    </el-tooltip>
                </div>
            </div>

            <VueFlow 
                v-model="elements" 
                :node-types="nodeTypes" 
                :default-edge-options="{ type: 'default', animated: true }"
                :connection-line-style="{ stroke: '#b1b1b7', strokeWidth: 2 }"
                :connection-radius="20"
                :snap-to-grid="true"
                :snap-grid="[15, 15]"
                :nodes-connectable="true"
                :edges-updatable="true"
                :nodes-draggable="!isSpacePressed"
                :select-nodes-on-drag="false"
                :pan-on-drag="isSpacePressed"
                :pan-on-scroll="true"
                :zoom-on-scroll="true"
                :zoom-on-double-click="true"
                :min-zoom="0.2"
                :max-zoom="4"
                :default-viewport="{ x: 0, y: 0, zoom: 0.8 }"
                :infinite="true"
                :is-valid-connection="isValidConnection"
                :only-render-visible-elements="true"
                @connect="onConnect"
                @connect-start="handleConnectStart"
                @connect-end="handleConnectEnd"
                @pane-contextmenu="handlePaneContextMenu"
            >
                <Background pattern-color="#aaa" :gap="8" />
                <Controls />
                <MiniMap />
            </VueFlow>
            
            <!-- 右键菜单 -->
            <ContextMenu
                :visible="contextMenuVisible"
                :position="contextMenuPosition"
                @insert-prompt="insertPromptNode"
                @insert-image="insertImageNode"
                @insert-dream="insertDreamNode"
                @insert-video="insertVideoNode"
            @insert-split="insertSplitNode"
            @insert-layer-separation="insertLayerSeparationNode"
            @add-group="handleAddGroup"
            @close="contextMenuVisible = false"
        />
            
            <!-- 连接菜单 -->
            <ConnectionMenu
                :visible="connectionMenuVisible"
                :position="connectionMenuPosition"
                @generate-image="handleConnectToImage"
                @generate-video="handleConnectToVideo"
                @close="connectionMenuVisible = false"
            />
        </div>

        <!-- 保存模板对话框 -->
        <el-dialog v-model="showSaveDialog" title="保存工作流模板" width="600px" @opened="() => { loadCategories(); saveForm.coverImage = getLastImageFromWorkflow(); }">
            <el-form :model="saveForm" label-width="100px">
                <el-form-item label="模板名称">
                    <el-input v-model="saveForm.name" placeholder="请输入模板名称" />
                </el-form-item>
                <el-form-item label="模板描述">
                    <el-input v-model="saveForm.description" type="textarea" :rows="3" placeholder="请输入模板描述（可选）" />
                </el-form-item>
                <el-form-item label="封面图片">
                    <div style="display: flex; gap: 12px; align-items: flex-start;">
                        <el-image 
                            v-if="saveForm.coverImage"
                            :src="saveForm.coverImage"
                            style="width: 120px; height: 120px; border: 1px solid #ddd; border-radius: 4px;"
                            fit="cover"
                            :preview-src-list="[saveForm.coverImage]"
                        />
                        <div v-else style="width: 120px; height: 120px; border: 1px dashed #ddd; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999;">
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
                    <el-select 
                        v-model="saveForm.category" 
                        placeholder="请选择分类"
                        style="width: 100%"
                    >
                        <el-option
                            v-for="cat in categories"
                            :key="cat.code"
                            :label="cat.name"
                            :value="cat.code"
                        />
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
    </div>
</template>

<script setup lang="ts">
import { ref, markRaw, onMounted, onUnmounted, h, provide } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { VueFlow, useVueFlow, type Connection } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, RefreshLeft, RefreshRight, Picture, ZoomIn, FullScreen, Collection, FolderOpened, Clock, EditPen, MagicStick, KnifeFork, Grid } from '@element-plus/icons-vue';
import { saveTemplate, getTemplates, getTemplate, deleteTemplate, autoSaveHistory, getHistoryList, getHistory, deleteHistory as deleteHistoryApi, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';
import { getActiveCategories, type WorkflowCategory } from '@/api/category';
import { uploadImage } from '@/api/upload';
import ContextMenu from '@/components/ContextMenu.vue';
import ConnectionMenu from '@/components/ConnectionMenu.vue';
import Sidebar from '@/components/Sidebar.vue';

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
import SplitNode from '@/components/nodes/SplitNode.vue';
import LayerSeparationNode from '@/components/nodes/LayerSeparationNode.vue';

// 注册节点类型
const nodeTypes = {
    dream: markRaw(DreamNode),
    upscale: markRaw(UpscaleNode),
    extend: markRaw(ExtendNode),
    image: markRaw(ImageNode),
    layer: markRaw(LayerNode),
    prompt: markRaw(PromptNode),
    video: markRaw(VideoNode),
    split: markRaw(SplitNode),
    layerSeparation: markRaw(LayerSeparationNode),
};

// 初始节点数据
const elements = ref([
    {
        id: '1',
        type: 'dream', // 对应 nodeTypes key
        position: { x: 250, y: 100 },
        data: { label: '初始节点' },
    },
]);

// 撤销/重做栈管理
const undoStack = ref<any[]>([]);
const redoStack = ref<any[]>([]);
const MAX_UNDO_STACK_SIZE = 50; // 最大撤销栈大小

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



const { addNodes, addEdges, getEdges, getNodes, setNodes, setEdges, removeNodes, findNode, screenToFlowCoordinate, viewport } = useVueFlow();
const router = useRouter();
const route = useRoute();

// 节点尺寸映射（根据实际节点大小）
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    'image': { width: 240, height: 300 },
    'prompt': { width: 320, height: 400 },
    'dream': { width: 400, height: 500 },
    'upscale': { width: 280, height: 350 },
    'extend': { width: 280, height: 350 },
    'video': { width: 350, height: 450 },
    'layer': { width: 300, height: 400 },
    'split': { width: 280, height: 350 },
    'layerSeparation': { width: 280, height: 400 }
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
        // 否则从画布中心开始（使用默认位置）
        startX = 400;
        startY = 300;
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

// 返回首页
const handleGoBack = () => {
    router.push('/');
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
        // 转换为完整URL
        if (lastImageUrl.startsWith('http')) {
            return lastImageUrl;
        }
        if (lastImageUrl.startsWith('/uploads/')) {
            return `${window.location.origin}${lastImageUrl}`;
        }
        return `${window.location.origin}/uploads/${lastImageUrl}`;
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
            const fullUrl = url.startsWith('http') 
                ? url 
                : url.startsWith('/uploads/')
                    ? `${window.location.origin}${url}`
                    : `${window.location.origin}/uploads/${url}`;
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

// Space 按住才允许拖拽平移画布
const isSpacePressed = ref(false);

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

    // 图片/提示词/视频节点作为 target 的限制
    if (targetNode.type === 'image' || targetNode.type === 'prompt' || targetNode.type === 'video') {
        // ✅ 允许“由生图节点生成的图片节点”作为输入被连线（它们的 data.fromNodeId 存在）
        if (targetNode.type === 'image' && (targetNode.data as any)?.fromNodeId) {
            return true;
        }

        // 其他情况一律禁止作为输入（包括用户上传的图片节点）
        ElMessage.warning('该节点不支持作为输入被连接');
        return false;
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

const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    isDragging.value = false;
    
    if (!event.dataTransfer) return;
    
    const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
        ElMessage.warning('请拖放图片文件');
        return;
    }
    
    // 获取鼠标位置并转换为画布坐标
    const position = screenToFlowCoordinate({
        x: event.clientX,
        y: event.clientY
    });
    
    // 上传文件并创建节点
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file) continue;
            
            const uploadRes: any = await uploadImage(file);
            
            if (uploadRes.data && uploadRes.data.url) {
                const imageUrl = uploadRes.data.url.startsWith('http')
                    ? uploadRes.data.url
                    : `${window.location.origin}${uploadRes.data.url}`;
                
                // 创建 ImageNode
                const nodeId = `image_node_${Date.now()}_${i}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position: {
                        x: position.x + i * 20,
                        y: position.y + i * 20
                    },
                    data: {
                        imageUrl: imageUrl,
                        originalImageUrl: uploadRes.data.url
                    }
                });
            }
        }
        
        ElMessage.success(`成功创建 ${files.length} 个图片节点`);
    } catch (error: any) {
        console.error('上传失败:', error);
        ElMessage.error(error.message || '图片上传失败');
    }
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

// 插入节点函数
const insertPromptNode = () => {
    const preferredPosition = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });
    const position = calculateOptimalPosition('prompt', preferredPosition);
    
    const nodeId = `prompt_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'prompt',
        position,
        data: { text: '' }
    });
    
    // 保存状态到撤销栈
    saveState();
};

const insertImageNode = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;

    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;

        const preferredPosition = screenToFlowCoordinate({
            x: contextMenuPosition.value.x,
            y: contextMenuPosition.value.y
        });
        const position = calculateOptimalPosition('image', preferredPosition);

        try {
            const uploadRes: any = await uploadImage(file);
            if (uploadRes.data && uploadRes.data.url) {
                const imageUrl = uploadRes.data.url.startsWith('http')
                    ? uploadRes.data.url
                    : `${window.location.origin}${uploadRes.data.url}`;

                const nodeId = `image_node_${Date.now()}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position,
                    data: {
                        imageUrl,
                        originalImageUrl: uploadRes.data.url
                    }
                });
                ElMessage.success('已插入图片节点');
                
                // 保存状态到撤销栈
                saveState();
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
    const preferredPosition = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });
    const position = calculateOptimalPosition('dream', preferredPosition);
    
    const nodeId = `dream_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'dream',
        position,
        data: {}
    });
    
    // 保存状态到撤销栈
    saveState();
};

const insertVideoNode = () => {
    const preferredPosition = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });
    const position = calculateOptimalPosition('video', preferredPosition);
    
    const nodeId = `video_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'video',
        position,
        data: {}
    });
    
    // 保存状态到撤销栈
    saveState();
};

const insertSplitNode = () => {
    const preferredPosition = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });
    const position = calculateOptimalPosition('split', preferredPosition);
    
    const nodeId = `split_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'split',
        position,
        data: {}
    });
    
    // 保存状态到撤销栈
    saveState();
};

const insertLayerSeparationNode = () => {
    const preferredPosition = screenToFlowCoordinate({
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
    });
    const position = calculateOptimalPosition('layerSeparation', preferredPosition);
    
    const nodeId = `layer_separation_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'layerSeparation',
        position,
        data: {}
    });
    
    // 保存状态到撤销栈
    saveState();
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
    
    // 保存状态到撤销栈
    saveState();
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

        const position = calculateOptimalPosition('image');

        try {
            const uploadRes: any = await uploadImage(file);
            if (uploadRes.data && uploadRes.data.url) {
                const imageUrl = uploadRes.data.url.startsWith('http')
                    ? uploadRes.data.url
                    : `${window.location.origin}${uploadRes.data.url}`;

                const nodeId = `image_node_${Date.now()}`;
                addNodes({
                    id: nodeId,
                    type: 'image',
                    position,
                    data: {
                        imageUrl,
                        originalImageUrl: uploadRes.data.url,
                    },
                });
                ElMessage.success('已添加图片节点');
                
                // 保存状态到撤销栈
                saveState();
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
    
    const position = calculateOptimalPosition('dream', pendingConnection.value.position);
    const nodeId = `dream_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'dream',
        position,
        data: {}
    });
    
    // 建立连接
    const sourceNode = findNode(pendingConnection.value.source);
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
    
    const position = calculateOptimalPosition('video', pendingConnection.value.position);
    const nodeId = `video_node_${Date.now()}`;
    addNodes({
        id: nodeId,
        type: 'video',
        position,
        data: {}
    });
    
    // 建立连接
    addEdges({
        id: `edge-${pendingConnection.value.source}-${nodeId}-${Date.now()}`,
        source: pendingConnection.value.source,
        target: nodeId,
        sourceHandle: pendingConnection.value.sourceHandle || 'source',
        targetHandle: 'target',
        type: 'default',
        animated: true
    });
    
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
    
    // 保存状态到撤销栈
    saveState();
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
    
    // 保存状态到撤销栈
    saveState();
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
    
    // 保存状态到撤销栈
    saveState();
};

const addSplitNode = () => {
    const position = calculateOptimalPosition('split');
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'split',
        position,
        data: {},
    });
    
    // 保存状态到撤销栈
    saveState();
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
    
    // 保存状态到撤销栈
    saveState();
};

// 保存模板
const handleSaveTemplate = async () => {
    if (!saveForm.value.name.trim()) {
        ElMessage.warning('请输入模板名称');
        return;
    }

    if (!saveForm.value.category) {
        ElMessage.warning('请选择分类');
        return;
    }

    saving.value = true;
    try {
        const workflowData = {
            nodes: getNodes.value,
            edges: getEdges.value
        };

        await saveTemplate({
            name: saveForm.value.name,
            description: saveForm.value.description,
            workflowData,
            isPublic: saveForm.value.isPublic,
            coverImage: saveForm.value.coverImage,
            category: saveForm.value.category
        });

        ElMessage.success('模板保存成功');
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
            ElMessage.success('模板加载成功');
            showLoadDialog.value = false;
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

// 加载历史记录列表
const loadHistories = async () => {
    try {
        const res: any = await getHistoryList(20);
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

        if (workflowData.nodes && workflowData.edges) {
            setNodes(workflowData.nodes);
            setEdges(workflowData.edges);
            ElMessage.success('历史记录恢复成功');
            showHistoryDialog.value = false;
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
            const workflowData = {
                nodes: getNodes.value,
                edges: getEdges.value
            };

            // 只有在有节点时才保存
            if (workflowData.nodes.length > 0) {
                await autoSaveHistory(workflowData);
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
            const nodeIds = selectedNodes.map(node => node.id);
            removeNodes(nodeIds);
            ElMessage.success(`已删除 ${selectedNodes.length} 个节点`);
            
            // 保存状态到撤销栈
            saveState();
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
    
    // 快捷键：V - 插入视频节点
    if (event.key === 'v' && !isInputElement) {
        event.preventDefault();
        insertVideoNode();
    }
    
    // 快捷键：S - 插入拆分节点
    if (event.key === 's' && !isInputElement) {
        event.preventDefault();
        insertSplitNode();
    }
    
    // 快捷键：L - 插入图层分离节点
    if (event.key === 'l' && !isInputElement) {
        event.preventDefault();
        insertLayerSeparationNode();
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

onMounted(async () => {
    // 启动自动保存
    startAutoSave();

    // 绑定快捷键
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // 处理URL参数
    const query = route.query;
    
    // 如果有id参数，加载模板
    if (query.id) {
        try {
            const templateId = parseInt(query.id as string);
            if (!isNaN(templateId)) {
                const res: any = await getTemplate(templateId);
                const workflowData = res.data.workflow_data;
                
                if (workflowData.nodes && workflowData.edges) {
                    setNodes(workflowData.nodes);
                    setEdges(workflowData.edges);
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
        
        const baseX = 100;
        const baseY = 200;
        const imageNodeHeight = NODE_DIMENSIONS.image?.height || 300;
        const verticalSpacing = imageNodeHeight + VERTICAL_PADDING; // 360 (节点高度 + 间距)
        const horizontalSpacing = 450; // 水平间距（增加间距避免重叠）
        const imageNodeIds: string[] = [];
        let promptNodeId: string | null = null;
        let dreamNodeId: string | null = null;
        
        // 创建图片节点（在左侧，垂直排列）
        imageUrls.forEach((imageUrl, index) => {
            const fullImageUrl = imageUrl.startsWith('http')
                ? imageUrl
                : `${window.location.origin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
            
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
        
        // 计算中间列和右侧列的Y坐标（真正的中心对齐）
        // 计算所有图片节点的总高度和中心位置
        let centerY = baseY;
        if (imageUrls.length > 0) {
            const totalHeight = imageUrls.length * imageNodeHeight + (imageUrls.length - 1) * VERTICAL_PADDING;
            const firstNodeTop = baseY;
            centerY = firstNodeTop + totalHeight / 2;
            
            // 调整中心位置，使其对齐到节点中心（而不是顶部）
            const promptNodeHeight = NODE_DIMENSIONS.prompt?.height || 400;
            const dreamNodeHeight = NODE_DIMENSIONS.dream?.height || 500;
            
            // 如果有提示词节点，使用提示词节点高度的一半来调整
            if (promptText.trim()) {
                centerY = centerY - promptNodeHeight / 2;
            } else {
                // 如果没有提示词节点，使用生图节点高度的一半来调整
                centerY = centerY - dreamNodeHeight / 2;
            }
        }
        
        // 创建提示词节点（在中间，如果有提示词）
        if (promptText.trim()) {
            promptNodeId = `prompt_node_${Date.now()}`;
            
            addNodes({
                id: promptNodeId,
                type: 'prompt',
                position: {
                    x: baseX + horizontalSpacing,
                    y: centerY
                },
                data: {
                    text: promptText.trim()
                }
            });
        }
        
        // 创建生图节点（在右侧）
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
        
        // 如果没有提示词节点，需要重新计算生图节点的Y坐标
        let dreamNodeY = centerY;
        if (!promptText.trim() && imageUrls.length > 0) {
            const dreamNodeHeight = NODE_DIMENSIONS.dream?.height || 500;
            const totalHeight = imageUrls.length * imageNodeHeight + (imageUrls.length - 1) * VERTICAL_PADDING;
            dreamNodeY = baseY + totalHeight / 2 - dreamNodeHeight / 2;
        }
        
        addNodes({
            id: dreamNodeId,
            type: 'dream',
            position: {
                x: baseX + horizontalSpacing * (promptText.trim() ? 2 : 1),
                y: dreamNodeY
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
        
        ElMessage.success(`已创建 ${imageUrls.length} 个图片节点${promptText.trim() ? '、1 个提示词节点' : ''}和 1 个生图节点，并已自动连接`);
    }
});

// 组件卸载时清理定时器和事件监听
onUnmounted(() => {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
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
    color: #606266;
}

.back-button-float:hover {
    color: #409eff;
}

.canvas-wrapper {
    flex: 1;
    background: #f5f5f5;
    overflow: hidden;
    min-height: 0;
    position: relative;
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
    background: #ffffff;
    border-radius: 10px;
    border: 1px solid #e0e0e0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.side-toolbar :deep(.el-button) {
    box-shadow: none;
    margin-left: 0 !important; /* 覆盖 Element Plus 默认的相邻按钮左间距，避免水平偏移 */
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
    border: 1px solid #e5e5e5;
    background-color: #fff;
    color: #606266;
}
</style>