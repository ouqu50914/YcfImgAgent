<template>
    <div class="storyboard-node">
        <div class="node-header">
            <el-icon><Film /></el-icon>
            <span>分镜节点</span>
            <el-tag v-if="shots.length" size="small" effect="plain" class="shot-count-tag">
                {{ shots.length }} 镜
            </el-tag>
        </div>

        <div class="node-content nodrag">
            <div class="conn-status">
                <div class="conn-row" :class="{ ok: hasScript }">
                    <span class="conn-label">剧本</span>
                    <span class="conn-value">{{ hasScript ? `${scriptCharCount} 字` : '请连线文本节点' }}</span>
                </div>
                <div class="conn-row" :class="{ ok: connectedSkills.length > 0 }">
                    <span class="conn-label">风格 Skill</span>
                    <span class="conn-value">
                        {{ connectedSkills.length ? connectedSkills.map((s) => s.name || 'Skill').join('、') : '可选' }}
                    </span>
                </div>
                <div class="conn-row" :class="{ ok: refImages.length > 0 }">
                    <span class="conn-label">参考图</span>
                    <span class="conn-value">{{ refImages.length ? `${refImages.length} 张` : '可选' }}</span>
                </div>
                <div class="conn-row" :class="{ ok: hasDownstreamDream }">
                    <span class="conn-label">下游生图</span>
                    <span class="conn-value">{{ hasDownstreamDream ? '已连接' : '请连线生图节点' }}</span>
                </div>
            </div>

            <div class="param-row">
                <div class="param-item half">
                    <div class="param-label">模式</div>
                    <el-select v-model="pipelineMode" size="small" style="width: 100%" @change="onPipelineModeChange">
                        <el-option label="视频分镜" value="video" />
                        <el-option label="四格漫画" value="comic" />
                    </el-select>
                </div>
                <div class="param-item half">
                    <div class="param-label">画面比例</div>
                    <el-select v-model="aspectRatio" size="small" style="width: 100%" :disabled="pipelineMode === 'comic'">
                        <el-option label="16:9" value="16:9" />
                        <el-option label="9:16" value="9:16" />
                        <el-option label="1:1" value="1:1" />
                    </el-select>
                </div>
            </div>

            <div v-if="pipelineMode === 'video'" class="param-row">
                <div class="param-item half">
                    <div class="param-label">最多镜头</div>
                    <el-input-number v-model="maxShots" :min="1" :max="20" size="small" />
                </div>
            </div>

            <p class="flow-hint">
                流程保持在同一链路：<strong>提示词 → 分镜 → 生图</strong>。处理结果会写回提示词节点，你改完点「确认/继续」即可。
            </p>

            <el-steps :active="stepActive" finish-status="success" align-center class="workflow-steps" simple>
                <el-step title="拆分分镜" />
                <el-step title="确认分镜" />
                <el-step title="生成提示词" />
                <el-step title="确认生图" />
            </el-steps>

            <!-- 分镜结构编辑 -->
            <div v-if="shots.length && showSplitEditor" class="shots-panel">
                <div class="panel-title">分镜结构（可编辑）</div>
                <div v-for="shot in shots" :key="shot.id" class="shot-card">
                    <div class="shot-card-head">
                        <span>#{{ shot.sequence }}</span>
                        <span v-if="shot.title" class="shot-title">{{ shot.title }}</span>
                    </div>
                    <el-input
                        v-model="shot.shotDescription"
                        type="textarea"
                        :rows="2"
                        resize="none"
                        placeholder="镜头/格子说明"
                    />
                </div>
            </div>

            <!-- 提示词编辑 -->
            <div v-if="shots.length && showPromptEditor" class="shots-panel">
                <div class="panel-title">
                    生图提示词（可编辑）
                    <span v-if="promptsConfirmed" class="panel-sub">
                        当前第 {{ activeShotIndex + 1 }} / {{ selectedShots.length }} 格
                    </span>
                </div>
                <div v-for="(shot, idx) in shots" :key="shot.id" class="shot-card" :class="{ active: promptsConfirmed && idx === activeShotIndex }">
                    <div class="shot-card-head">
                        <el-checkbox v-model="shot.selected" />
                        <span>#{{ shot.sequence }}</span>
                        <span v-if="shot.title" class="shot-title">{{ shot.title }}</span>
                        <el-button
                            v-if="promptsConfirmed && shot.selected !== false"
                            size="small"
                            link
                            type="primary"
                            @click="activeShotIndex = idx"
                        >
                            设为当前
                        </el-button>
                    </div>
                    <p v-if="shot.shotDescription" class="shot-desc-preview">{{ shot.shotDescription }}</p>
                    <el-input
                        v-model="shot.prompt"
                        type="textarea"
                        :rows="3"
                        resize="none"
                        placeholder="中文生图/视频提示词"
                    />
                </div>
            </div>

            <div class="node-actions">
                <el-button
                    v-if="workflowStep === 'idle'"
                    type="primary"
                    size="small"
                    :loading="generating"
                    :disabled="!effectiveScript.trim()"
                    @click="handleSplitShots"
                >
                    Gemini 拆分分镜
                </el-button>

                <template v-if="workflowStep === 'split_pending'">
                    <el-button type="primary" size="small" @click="confirmSplitAndContinue">
                        确认分镜，继续
                    </el-button>
                    <el-button size="small" @click="syncSplitToPromptNode">同步到提示词节点</el-button>
                </template>

                <template v-if="workflowStep === 'split_confirmed' && !hasPrompts">
                    <el-button type="primary" size="small" :loading="generating" @click="handleGeneratePrompts">
                        生成提示词
                    </el-button>
                </template>

                <template v-if="hasPrompts && workflowStep !== 'prompts_confirmed'">
                    <el-button type="primary" size="small" @click="confirmPromptsAndContinue">
                        确认提示词，继续
                    </el-button>
                    <el-button size="small" @click="syncPromptsToPromptNode">同步到提示词节点</el-button>
                </template>

                <template v-if="workflowStep === 'prompts_confirmed'">
                    <el-button type="primary" size="small" @click="syncActiveShotToPrompt">
                        同步当前格到提示词
                    </el-button>
                    <el-button size="small" :disabled="activeShotIndex <= 0" @click="prevShot">上一格</el-button>
                    <el-button size="small" :disabled="activeShotIndex >= selectedShots.length - 1" @click="nextShot">下一格</el-button>
                </template>
            </div>

            <p v-if="workflowStep === 'prompts_confirmed'" class="execute-hint">
                提示词已同步到左侧文本节点，请在下游<strong>生图节点</strong>点击执行；每格生图完成后点「下一格」继续。
            </p>
        </div>

        <Handle id="storyboard-target" type="target" :position="Position.Left" :style="targetHandleStyle" />
        <Handle id="storyboard-source" type="source" :position="Position.Right" :style="sourceHandleStyle" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Handle, Position, useVueFlow, type NodeProps } from '@vue-flow/core';
import { Film } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { generateStoryboard, type StoryboardShot, type StoryboardTemplate, type StoryboardPhase } from '@/api/storyboard';
import { readConnectedSkillsFromEdges, type SkillFragment } from '@/utils/skill-prompt';

const props = defineProps<NodeProps>();

const { getEdges, getNodes, updateNodeData } = useVueFlow();

const initialShots = Array.isArray((props.data as { shots?: StoryboardShot[] })?.shots)
    ? ((props.data as { shots: StoryboardShot[] }).shots as StoryboardShot[])
    : [];

type WorkflowStep = 'idle' | 'split_pending' | 'split_confirmed' | 'prompts_confirmed';

const initialWorkflowStep = (props.data as { workflowStep?: WorkflowStep })?.workflowStep || 'idle';

const localScript = ref(typeof props.data?.localScript === 'string' ? props.data.localScript : '');
const maxShots = ref(typeof props.data?.maxShots === 'number' ? props.data.maxShots : 10);
const aspectRatio = ref(typeof props.data?.aspectRatio === 'string' ? props.data.aspectRatio : '16:9');
const pipelineMode = ref<'video' | 'comic'>(props.data?.pipelineMode === 'comic' ? 'comic' : 'video');
const shots = ref<StoryboardShot[]>(initialShots.map((s) => ({ ...s, selected: s.selected !== false })));
const workflowStep = ref<WorkflowStep>(initialWorkflowStep);
const generating = ref(false);
const activeShotIndex = ref(typeof props.data?.activeShotIndex === 'number' ? props.data.activeShotIndex : 0);

const connectedSkills = ref<SkillFragment[]>([]);
const connectedScript = ref('');
const refImages = ref<{ id: string; url: string; label: string }[]>([]);

const targetHandleStyle = {
    background: '#409eff',
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    cursor: 'crosshair',
};

const sourceHandleStyle = {
    background: '#67c23a',
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    cursor: 'crosshair',
};

const effectiveScript = computed(() => localScript.value.trim() || connectedScript.value.trim());
const hasScript = computed(() => effectiveScript.value.length > 0);
const scriptCharCount = computed(() => effectiveScript.value.length);
const selectedShots = computed(() => shots.value.filter((s) => s.selected !== false));
const hasPrompts = computed(() => shots.value.some((s) => s.prompt?.trim()));
const promptsConfirmed = computed(() => workflowStep.value === 'prompts_confirmed');
const showSplitEditor = computed(
    () => shots.value.length > 0 && (workflowStep.value === 'split_pending' || (workflowStep.value === 'split_confirmed' && !hasPrompts.value))
);
const showPromptEditor = computed(() => hasPrompts.value);

const stepActive = computed(() => {
    if (workflowStep.value === 'idle') return 0;
    if (workflowStep.value === 'split_pending') return 1;
    if (workflowStep.value === 'split_confirmed' && !hasPrompts.value) return 2;
    if (workflowStep.value === 'split_confirmed' && hasPrompts.value) return 3;
    if (workflowStep.value === 'prompts_confirmed') return 4;
    return 0;
});

const hasDownstreamDream = computed(() => {
    return getEdges.value.some((e) => e.source === props.id && getNodes.value.find((n) => n.id === e.target)?.type === 'dream');
});

function getUpstreamPromptNodeId(): string | null {
    for (const e of getEdges.value) {
        if (e.target !== props.id) continue;
        const n = getNodes.value.find((x) => x.id === e.source);
        if (n?.type === 'prompt') return n.id;
    }
    return null;
}

function formatShotsDocument(mode: 'split' | 'prompt' | 'active'): string {
    const list = mode === 'active' ? [selectedShots.value[activeShotIndex.value]].filter(Boolean) : shots.value;
    if (mode === 'split') {
        return list
            .map((s) => {
                const head = `【第 ${s.sequence} 镜${s.title ? ` · ${s.title}` : ''}】`;
                return `${head}\n${s.shotDescription || ''}`;
            })
            .join('\n\n');
    }
    if (mode === 'active') {
        const s = list[0];
        if (!s) return '';
        return s.prompt?.trim() || '';
    }
    return list
        .map((s) => {
            const head = `【第 ${s.sequence} 镜${s.title ? ` · ${s.title}` : ''}】`;
            const desc = s.shotDescription ? `${s.shotDescription}\n\n` : '';
            return `${head}\n${desc}提示词：\n${s.prompt || ''}`;
        })
        .join('\n\n---\n\n');
}

function syncToPromptNode(content: string, silent = false): boolean {
    const promptId = getUpstreamPromptNodeId();
    if (!promptId) {
        if (!silent) ElMessage.warning('请先连接上游提示词节点（文本 → 分镜）');
        return false;
    }
    updateNodeData(promptId, { text: content });
    if (!silent) ElMessage.success('已同步到提示词节点，可直接编辑');
    return true;
}

function syncSplitToPromptNode() {
    syncToPromptNode(formatShotsDocument('split'));
}

function syncPromptsToPromptNode() {
    syncToPromptNode(formatShotsDocument('prompt'));
}

function syncActiveShotToPrompt() {
    const shot = selectedShots.value[activeShotIndex.value];
    if (!shot?.prompt?.trim()) {
        ElMessage.warning('当前格提示词为空');
        return;
    }
    props.data.outputPrompt = shot.prompt.trim();
    if (syncToPromptNode(shot.prompt.trim())) {
        ElMessage.info(`第 ${shot.sequence} 格已同步，请在生图节点执行`);
    }
}

function prevShot() {
    if (activeShotIndex.value > 0) {
        activeShotIndex.value -= 1;
        syncActiveShotToPrompt();
    }
}

function nextShot() {
    if (activeShotIndex.value < selectedShots.value.length - 1) {
        activeShotIndex.value += 1;
        syncActiveShotToPrompt();
    }
}

function readConnectedScript(): string {
    for (const e of getEdges.value) {
        if (e.target !== props.id) continue;
        const n = getNodes.value.find((x) => x.id === e.source);
        if (n?.type === 'prompt' && typeof n.data?.text === 'string') {
            const t = n.data.text.trim();
            if (t) return t;
        }
    }
    return '';
}

function readConnectedImages() {
    const list: { id: string; url: string; label: string }[] = [];
    for (const e of getEdges.value) {
        if (e.target !== props.id) continue;
        const n = getNodes.value.find((x) => x.id === e.source);
        if (n?.type !== 'image' || !n.data?.imageUrl) continue;
        const url = String(n.data.imageUrl);
        const alias = (n.data as { imageAlias?: string }).imageAlias;
        list.push({
            id: n.id,
            url,
            label: alias ? `@${alias}` : `图片 ${list.length + 1}`,
        });
    }
    return list;
}

function refreshConnections() {
    connectedScript.value = readConnectedScript();
    connectedSkills.value = readConnectedSkillsFromEdges({
        targetNodeId: props.id,
        edges: getEdges.value,
        nodes: getNodes.value,
        targetScope: pipelineMode.value === 'comic' ? 'image' : 'video',
    });
    refImages.value = readConnectedImages();
}

function syncToNodeData() {
    props.data.localScript = localScript.value;
    props.data.maxShots = maxShots.value;
    props.data.aspectRatio = aspectRatio.value;
    props.data.pipelineMode = pipelineMode.value;
    props.data.shots = shots.value;
    props.data.workflowStep = workflowStep.value;
    props.data.activeShotIndex = activeShotIndex.value;
}

watch([localScript, maxShots, aspectRatio, pipelineMode, shots, workflowStep, activeShotIndex], syncToNodeData, { deep: true });
watch(() => [getEdges.value, getNodes.value], refreshConnections, { deep: true, immediate: true });

onMounted(refreshConnections);

const onPipelineModeChange = (mode: 'video' | 'comic') => {
    if (mode === 'comic') {
        maxShots.value = 4;
        aspectRatio.value = '1:1';
    }
    workflowStep.value = 'idle';
    shots.value = [];
};

function assignDefaultReferenceImages(list: StoryboardShot[]) {
    const defaultRef = refImages.value[0]?.url;
    if (!defaultRef) return list;
    return list.map((s) => ({
        ...s,
        referenceImageUrl: s.referenceImageUrl || defaultRef,
    }));
}

async function runStoryboardGenerate(template: StoryboardTemplate | undefined, phase: StoryboardPhase) {
    const script = effectiveScript.value;
    if (!script) {
        ElMessage.warning('请先输入文案或连线文本节点');
        return;
    }
    generating.value = true;
    try {
        const res = await generateStoryboard({
            script,
            skills: connectedSkills.value.map((s) => ({
                name: s.name,
                content: s.content,
                format: s.format,
                apply_mode: s.apply_mode,
                description: s.description,
            })),
            maxShots: template === 'four_panel_comic' ? 4 : maxShots.value,
            aspectRatio: aspectRatio.value,
            template,
            phase,
            shots: phase === 'prompts' ? shots.value : undefined,
        });
        let list = (res as { data?: { shots?: StoryboardShot[] } }).data?.shots || [];
        if (phase === 'split') {
            list = assignDefaultReferenceImages(list.map((s) => ({ ...s, prompt: '', selected: true })));
            shots.value = list;
            workflowStep.value = 'split_pending';
            syncToPromptNode(formatShotsDocument('split'), true);
            ElMessage.success(`已拆分 ${list.length} 镜，请在本节点或提示词节点中修改后点「确认分镜，继续」`);
        } else if (phase === 'prompts') {
            list = assignDefaultReferenceImages(list.map((s) => ({ ...s, selected: true })));
            shots.value = list;
            syncToPromptNode(formatShotsDocument('prompt'), true);
            ElMessage.success('提示词已生成，请修改后点「确认提示词，继续」');
        }
    } catch (error: any) {
        ElMessage.error(error?.message || '生成失败');
    } finally {
        generating.value = false;
    }
}

const resolveTemplate = (): StoryboardTemplate | undefined =>
    pipelineMode.value === 'comic' ? 'four_panel_comic' : 'default';

const handleSplitShots = () => {
    if (pipelineMode.value === 'comic') {
        maxShots.value = 4;
        aspectRatio.value = '1:1';
    }
    runStoryboardGenerate(resolveTemplate(), 'split');
};

const handleGeneratePrompts = () => {
    if (workflowStep.value !== 'split_confirmed') {
        ElMessage.warning('请先确认分镜');
        return;
    }
    runStoryboardGenerate(resolveTemplate(), 'prompts');
};

const confirmSplitAndContinue = () => {
    if (!shots.value.length) {
        ElMessage.warning('分镜列表为空');
        return;
    }
    if (shots.value.some((s) => !s.shotDescription?.trim())) {
        ElMessage.warning('请完善每镜/每格的说明');
        return;
    }
    workflowStep.value = 'split_confirmed';
    syncSplitToPromptNode();
    ElMessage.success('分镜已确认，可点击「生成提示词」');
};

const confirmPromptsAndContinue = () => {
    if (!selectedShots.value.length) {
        ElMessage.warning('请至少保留一格/镜');
        return;
    }
    if (selectedShots.value.some((s) => !s.prompt?.trim())) {
        ElMessage.warning('请完善所选镜头的提示词');
        return;
    }
    workflowStep.value = 'prompts_confirmed';
    activeShotIndex.value = 0;
    syncActiveShotToPrompt();
    ElMessage.success('提示词已确认，请连接生图节点并逐格执行');
};
</script>

<style scoped>
.storyboard-node {
    width: 520px;
    background: var(--node-bg, #fff);
    border: 1px solid var(--node-border, #dcdfe6);
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    overflow: hidden;
}

.node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
    color: #fff;
    font-weight: 600;
    font-size: 14px;
}

.shot-count-tag {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: #fff;
}

.node-content {
    padding: 12px 14px 14px;
}

.conn-status {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: var(--app-bg-sub, #f5f7fa);
    border-radius: 8px;
    font-size: 12px;
}

.conn-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    color: var(--text-muted, #909399);
}

.conn-row.ok .conn-value {
    color: var(--text-soft, #606266);
}

.conn-label {
    flex-shrink: 0;
    font-weight: 500;
}

.conn-value {
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
}

.param-row {
    display: flex;
    gap: 10px;
    margin-bottom: 8px;
}

.param-item.half {
    flex: 1;
}

.param-label {
    font-size: 12px;
    color: var(--text-muted, #909399);
    margin-bottom: 4px;
}

.flow-hint {
    margin: 0 0 10px;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-soft, #606266);
    background: #f0f9eb;
    border-radius: 8px;
    border: 1px solid #e1f3d8;
}

.workflow-steps {
    margin: 8px 0 12px;
}

.workflow-steps :deep(.el-step__title) {
    font-size: 11px;
    max-width: 64px;
    line-height: 1.3;
}

.shots-panel {
    margin-bottom: 12px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--el-border-color-lighter, #ebeef5);
    border-radius: 8px;
    padding: 8px;
    background: var(--app-bg-sub, #fafafa);
}

.panel-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-soft, #606266);
    margin-bottom: 8px;
}

.panel-sub {
    font-weight: normal;
    color: var(--text-muted, #909399);
    margin-left: 8px;
}

.shot-card {
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 6px;
    background: var(--node-bg, #fff);
    border: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.shot-card.active {
    border-color: #409eff;
    box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.2);
}

.shot-card:last-child {
    margin-bottom: 0;
}

.shot-card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #409eff;
}

.shot-title {
    color: var(--text-soft, #606266);
    font-weight: normal;
}

.shot-desc-preview {
    margin: 0 0 6px;
    font-size: 11px;
    color: var(--text-muted, #909399);
    line-height: 1.4;
}

.node-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.execute-hint {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted, #909399);
}

.storyboard-node :deep(.vue-flow__handle) {
    opacity: 0.35;
    transition: opacity 0.15s ease;
}

.storyboard-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
}
</style>
