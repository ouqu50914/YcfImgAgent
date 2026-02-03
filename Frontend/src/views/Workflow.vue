<template>
    <div class="workflow-container">
        <div class="toolbar">
            <div class="toolbar-left">
                <el-button 
                    text 
                    :icon="ArrowLeft" 
                    @click="handleGoBack"
                    class="back-button"
                >
                    返回
                </el-button>
                <h3>🎨 AI 工作流编辑器</h3>
            </div>
            <div class="toolbar-buttons">
                <el-button type="primary" size="small" @click="addNode">添加生图节点</el-button>
                <el-button type="success" size="small" @click="addUpscaleNode">添加放大节点</el-button>
                <el-button type="success" size="small" @click="addExtendNode">添加扩展节点</el-button>
                <el-button type="warning" size="small" @click="showSaveDialog = true">保存模板</el-button>
                <el-button type="info" size="small" @click="showLoadDialogHandler">加载模板</el-button>
                <el-button type="success" size="small" @click="showHistoryDialogHandler">历史记录</el-button>
            </div>
        </div>

        <div class="canvas-wrapper">
            <VueFlow 
                v-model="elements" 
                :node-types="nodeTypes" 
                fit-view-on-init
                :default-edge-options="{ type: 'default', animated: true }"
                :connection-line-style="{ stroke: '#b1b1b7', strokeWidth: 2 }"
                :connection-radius="20"
                :snap-to-grid="true"
                :snap-grid="[15, 15]"
                :nodes-connectable="true"
                :edges-updatable="true"
                :nodes-draggable="true"
                :select-nodes-on-drag="false"
                :pan-on-drag="true"
                :pan-on-scroll="true"
                :zoom-on-scroll="true"
                :zoom-on-double-click="true"
                :min-zoom="0.2"
                :max-zoom="4"
                :default-viewport="{ x: 0, y: 0, zoom: 1 }"
                :infinite="true"
                :is-valid-connection="isValidConnection"
                :only-render-visible-elements="true"
                @connect="onConnect"
                @connect-start="(e) => console.log('连接开始:', e)"
                @connect-end="(e) => console.log('连接结束:', e)"
            >
                <Background pattern-color="#aaa" :gap="8" />
                <Controls />
                <MiniMap />
            </VueFlow>
        </div>

        <!-- 保存模板对话框 -->
        <el-dialog v-model="showSaveDialog" title="保存工作流模板" width="600px" @opened="() => { saveForm.coverImage = getLastImageFromWorkflow(); }">
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
import { ref, markRaw, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { VueFlow, useVueFlow, type Connection } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { saveTemplate, getTemplates, getTemplate, deleteTemplate, autoSaveHistory, getHistoryList, getHistory, deleteHistory as deleteHistoryApi, type WorkflowTemplate, type WorkflowHistory } from '@/api/workflow';

// 引入默认样式
import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

// 引入自定义节点
import DreamNode from '@/components/nodes/DreamNode.vue';
import UpscaleNode from '@/components/nodes/UpscaleNode.vue';
import ExtendNode from '@/components/nodes/ExtendNode.vue';
import ImageNode from '@/components/nodes/ImageNode.vue';

// 注册节点类型
const nodeTypes = {
    dream: markRaw(DreamNode),
    upscale: markRaw(UpscaleNode),
    extend: markRaw(ExtendNode),
    image: markRaw(ImageNode),
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

const { addNodes, addEdges, getEdges, getNodes, setNodes, setEdges, removeNodes } = useVueFlow();
const router = useRouter();

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
    coverImage: '' as string
});

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
    
    if (imageNodes.length > 0) {
        const lastImageUrl = imageNodes[0].data.imageUrl;
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

// 连接验证函数：允许所有连接
const isValidConnection = (connection: Connection) => {
    console.log('连接验证:', connection);
    // 不允许自己连接自己
    if (connection.source === connection.target) {
        return false;
    }
    // 允许所有其他连接
    return true;
};

// 连接成功事件处理
const onConnect = (connection: Connection) => {
    console.log('连接成功:', connection);
    
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
        } else {
            console.log('连接已存在，跳过');
        }
    }
};

// 添加新节点逻辑
const addNode = () => {
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'dream',
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label: `节点 ${id}` },
    });
};

const addUpscaleNode = () => {
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'upscale',
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: {},
    });
};

const addExtendNode = () => {
    const id = Date.now().toString();
    addNodes({
        id,
        type: 'extend',
        position: { x: Math.random() * 400, y: Math.random() * 400 },
        data: {},
    });
};

// 保存模板
const handleSaveTemplate = async () => {
    if (!saveForm.value.name.trim()) {
        ElMessage.warning('请输入模板名称');
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
            coverImage: saveForm.value.coverImage
        });

        ElMessage.success('模板保存成功');
        showSaveDialog.value = false;
        saveForm.value = { name: '', description: '', isPublic: false, coverImage: '' };
        loadTemplates();
    } catch (error: any) {
        ElMessage.error(error.message || '保存失败');
    } finally {
        saving.value = false;
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
    
    // Ctrl+S 或 Cmd+S: 保存模板
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (getNodes.value.length > 0) {
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
        }
    }

    // Ctrl+Z 或 Cmd+Z: 撤销（需要实现撤销栈）
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        ElMessage.info('撤销功能待实现');
    }

    // Ctrl+Y 或 Cmd+Shift+Z: 重做
    if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        ElMessage.info('重做功能待实现');
    }
};

onMounted(() => {
    // 启动自动保存
    startAutoSave();

    // 绑定快捷键
    window.addEventListener('keydown', handleKeyDown);
});

// 组件卸载时清理定时器和事件监听
onUnmounted(() => {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }
    window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
.workflow-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

.toolbar {
    height: 50px;
    background: #fff;
    border-bottom: 1px solid #ddd;
    display: flex;
    align-items: center;
    padding: 0 20px;
    justify-content: space-between;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    z-index: 10;
}

.toolbar-left {
    display: flex;
    align-items: center;
    gap: 16px;
}

.toolbar-left h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #303133;
}

.back-button {
    padding: 8px 12px;
    font-size: 14px;
    color: #606266;
    transition: color 0.2s;
}

.back-button:hover {
    color: #409eff;
}

.toolbar-buttons {
    display: flex;
    gap: 10px;
}

.canvas-wrapper {
    flex: 1;
    background: #f5f5f5;
    overflow: hidden;
    min-height: 0;
}
</style>