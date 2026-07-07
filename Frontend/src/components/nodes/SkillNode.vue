<template>
    <div class="skill-node">
        <div class="node-header">
            <el-icon><MagicStick /></el-icon>
            <span>Skill 节点</span>
            <el-tag v-if="formatLabelText" size="small" class="scope-tag" effect="plain">{{ formatLabelText }}</el-tag>
        </div>

        <div class="node-content nodrag">
            <div class="param-item">
                <div class="param-label">从库选择</div>
                <el-select
                    v-model="selectedSkillId"
                    placeholder="选择已保存的 Skill"
                    size="small"
                    clearable
                    filterable
                    class="param-select"
                    @change="onSkillSelected"
                >
                    <el-option
                        v-for="item in skillLibrary"
                        :key="item.id"
                        :label="item.name"
                        :value="item.id"
                    >
                        <span>{{ item.name }}</span>
                        <span class="option-scope">{{ formatText(item.format) }} · {{ scopeText(item.scope) }}</span>
                    </el-option>
                </el-select>
            </div>

            <div class="param-item">
                <div class="param-label">格式</div>
                <el-select v-model="format" size="small" class="param-select">
                    <el-option label="纯文本 Skill" value="plain" />
                    <el-option label="Agent Skills 标准 SKILL.md" value="agent_skill" />
                </el-select>
            </div>

            <div class="param-item">
                <div class="param-label">应用方式</div>
                <el-select v-model="applyMode" size="small" class="param-select">
                    <el-option label="直接合并到提示词" value="merge" />
                    <el-option label="Gemini 智能预处理" value="preprocess" />
                </el-select>
            </div>

            <div class="param-item">
                <div class="param-label">适用范围</div>
                <el-select v-model="scope" size="small" class="param-select">
                    <el-option label="生图 + 生视频" value="both" />
                    <el-option label="仅生图" value="image" />
                    <el-option label="仅生视频" value="video" />
                </el-select>
            </div>

            <div class="param-item">
                <div class="param-label">Skill 指令</div>
                <el-input
                    v-model="content"
                    type="textarea"
                    :rows="6"
                    placeholder="输入风格、角色设定、镜头语言、禁止项等固定指令…"
                    class="skill-textarea"
                />
            </div>

            <div class="skill-actions">
                <el-button
                    size="small"
                    type="primary"
                    :disabled="!content.trim()"
                    @click="showSaveDialog = true"
                >
                    保存到库
                </el-button>
            </div>

            <div v-if="content.trim()" class="skill-hint">
                {{ applyMode === 'preprocess' ? '执行时由 Gemini 按 Skill 规则预处理提示词。' : '执行时直接合并到提示词前面。' }}
            </div>
        </div>

        <Handle
            id="skill-source"
            type="source"
            :position="Position.Right"
            :style="{
                background: '#67c23a',
                width: '12px',
                height: '12px',
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair',
            }"
        />

        <el-dialog
            v-model="showSaveDialog"
            title="保存 Skill"
            width="520px"
            append-to-body
            @close="resetSaveForm"
        >
            <el-form label-width="88px">
                <el-form-item label="名称" required>
                    <el-input v-model="saveName" maxlength="100" show-word-limit placeholder="例如：赛博朋克风格" />
                </el-form-item>
                <el-form-item label="适用范围">
                    <el-select v-model="saveScope" style="width: 100%">
                        <el-option label="生图 + 生视频" value="both" />
                        <el-option label="仅生图" value="image" />
                        <el-option label="仅生视频" value="video" />
                    </el-select>
                </el-form-item>
                <el-form-item label="描述">
                    <el-input v-model="saveDescription" type="textarea" :rows="2" maxlength="200" show-word-limit />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button @click="showSaveDialog = false">取消</el-button>
                <el-button type="primary" :loading="saving" @click="handleSaveSkill">保存</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { MagicStick } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import {
    createGenerationSkill,
    getGenerationSkills,
    type GenerationSkill,
    type GenerationSkillScope,
    type GenerationSkillFormat,
    type GenerationSkillApplyMode,
    isAgentSkillFormat,
} from '@/api/skill';
import { formatLabel } from '@/utils/skill-import';

const props = defineProps<NodeProps>();

const initialData = (props.data || {}) as {
    skillId?: number | null;
    name?: string;
    content?: string;
    scope?: GenerationSkillScope;
    format?: GenerationSkillFormat;
    apply_mode?: GenerationSkillApplyMode;
    description?: string;
};

const selectedSkillId = ref<number | null>(initialData.skillId ?? null);
const name = ref(initialData.name || '');
const content = ref(initialData.content || '');
const scope = ref<GenerationSkillScope>(initialData.scope || 'both');
const format = ref<GenerationSkillFormat>(initialData.format || 'plain');
const applyMode = ref<GenerationSkillApplyMode>(
    initialData.apply_mode || (isAgentSkillFormat(initialData.format) ? 'preprocess' : 'merge')
);
const description = ref(initialData.description || '');

const skillLibrary = ref<GenerationSkill[]>([]);
const showSaveDialog = ref(false);
const saveName = ref('');
const saveDescription = ref('');
const saveScope = ref<GenerationSkillScope>('both');
const saving = ref(false);

const scopeText = (s: GenerationSkillScope) => {
    if (s === 'image') return '生图';
    if (s === 'video') return '生视频';
    return '通用';
};

const formatText = (f?: GenerationSkillFormat) => formatLabel(f || 'plain');

const formatLabelText = computed(() => (content.value.trim() ? formatText(format.value) : ''));

watch(format, (f) => {
    if (isAgentSkillFormat(f) && applyMode.value === 'merge') {
        applyMode.value = 'preprocess';
    }
});

const syncToNodeData = () => {
    props.data.skillId = selectedSkillId.value;
    props.data.name = name.value;
    props.data.content = content.value;
    props.data.scope = scope.value;
    props.data.format = format.value;
    props.data.apply_mode = applyMode.value;
    props.data.description = description.value;
};

watch([selectedSkillId, name, content, scope, format, applyMode, description], syncToNodeData, { immediate: true });

const loadSkillLibrary = async () => {
    try {
        const res: { data?: GenerationSkill[] } = await getGenerationSkills();
        skillLibrary.value = res.data || [];
    } catch (error) {
        console.error('加载 Skill 库失败:', error);
    }
};

const onSkillSelected = (id: number | null | undefined) => {
    if (id == null) {
        selectedSkillId.value = null;
        return;
    }
    const found = skillLibrary.value.find((s) => s.id === id);
    if (!found) return;
    selectedSkillId.value = found.id;
    name.value = found.name;
    content.value = found.content;
    scope.value = found.scope;
    format.value = found.format || 'plain';
    applyMode.value = found.apply_mode || (isAgentSkillFormat(found.format) ? 'preprocess' : 'merge');
    description.value = found.description || '';
};

const resetSaveForm = () => {
    saveName.value = name.value || '';
    saveDescription.value = '';
    saveScope.value = scope.value;
};

watch(showSaveDialog, (open) => {
    if (open) {
        saveName.value = name.value || '';
        saveScope.value = scope.value;
    }
});

const handleSaveSkill = async () => {
    const trimmedName = saveName.value.trim();
    const trimmedContent = content.value.trim();
    if (!trimmedName || !trimmedContent) {
        ElMessage.warning('请填写 Skill 名称和指令内容');
        return;
    }

    saving.value = true;
    try {
        const res: { data?: GenerationSkill } = await createGenerationSkill({
            name: trimmedName,
            content: trimmedContent,
            scope: saveScope.value,
            description: saveDescription.value.trim() || undefined,
            format: format.value,
            apply_mode: applyMode.value,
        });
        ElMessage.success('Skill 已保存');
        showSaveDialog.value = false;
        await loadSkillLibrary();
        if (res.data?.id) {
            selectedSkillId.value = res.data.id;
            name.value = res.data.name;
            scope.value = res.data.scope;
        } else {
            name.value = trimmedName;
            scope.value = saveScope.value;
        }
    } catch (error: any) {
        ElMessage.error(error?.message || '保存失败');
    } finally {
        saving.value = false;
    }
};

onMounted(() => {
    loadSkillLibrary();
});
</script>

<style scoped>
.skill-node {
    width: 340px;
    background: var(--app-surface, #1a1a1a);
    border: 1px solid var(--app-border-color, #333);
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;
}

.node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(103, 194, 58, 0.12);
    border-bottom: 1px solid var(--app-border-color, #333);
    font-weight: 600;
}

.scope-tag {
    margin-left: auto;
}

.node-content {
    padding: 12px;
}

.param-item {
    margin-bottom: 10px;
}

.param-label {
    margin-bottom: 4px;
    color: var(--text-soft, #aaa);
    font-size: 12px;
}

.param-select {
    width: 100%;
}

.skill-textarea :deep(textarea) {
    font-family: inherit;
    line-height: 1.5;
}

.skill-actions {
    display: flex;
    justify-content: flex-end;
}

.skill-hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted, #888);
    line-height: 1.4;
}

.option-scope {
    float: right;
    color: var(--text-muted, #888);
    font-size: 12px;
}

.skill-node :deep(.vue-flow__handle) {
    opacity: 0.35;
    transition: opacity 0.15s ease;
}

.skill-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
}
</style>
