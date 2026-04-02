<template>
    <div class="prompt-node" :style="{ width: promptWidth + 'px' }">
        <div class="node-header">
            <el-icon><EditPen /></el-icon>
            <span>提示词输入</span>
        </div>

        <div class="node-content">
            <div v-if="editor" class="prompt-toolbar nodrag">
                <button
                    type="button"
                    class="tb-btn"
                    title="撤销"
                    :disabled="!canUndo"
                    @mousedown.prevent
                    @click="run(() => editor!.chain().focus().undo().run())"
                >
                    ↶
                </button>
                <button
                    type="button"
                    class="tb-btn"
                    title="重做"
                    :disabled="!canRedo"
                    @mousedown.prevent
                    @click="run(() => editor!.chain().focus().redo().run())"
                >
                    ↷
                </button>
            </div>

            <div class="prompt-content nodrag">
                <div class="prompt-input-wrap" @wheel.stop>
                    <EditorContent v-if="editor" :editor="editor" class="prompt-editor-host" />

                    <div
                        v-if="showPromptSuggestions && promptTemplates.length > 0"
                        class="prompt-suggestions"
                    >
                        <div
                            v-for="(template, index) in filteredTemplates"
                            :key="template.id"
                            class="suggestion-item"
                            :class="{ active: selectedSuggestionIndex === index }"
                            @click="selectPromptTemplate(template)"
                            @mouseenter="selectedSuggestionIndex = index"
                        >
                            <span class="suggestion-dot" />
                            <span class="suggestion-name">{{ template.name || '未命名提示词' }}</span>
                        </div>
                    </div>

                    <div
                        v-if="showAliasSuggestions && aliasSuggestions.length > 0"
                        class="prompt-suggestions alias-suggestions"
                    >
                        <div
                            v-for="(item, index) in aliasSuggestions"
                            :key="item.key"
                            class="suggestion-item"
                            :class="{ active: selectedAliasIndex === index }"
                            @click="selectImageAlias(item)"
                            @mouseenter="selectedAliasIndex = index"
                        >
                            <span class="suggestion-dot" />
                            <span class="suggestion-name">{{ '@' + item.alias }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="prompt-meta nodrag">
                <span class="char-count">{{ plainCharCount }} / {{ MAX_PLAIN_CHARS }}</span>
            </div>

            <div class="prompt-actions nodrag">
                <el-button
                    size="small"
                    type="primary"
                    class="save-prompt-btn"
                    :disabled="!text.trim()"
                    @click="showSavePromptDialog = true"
                >
                    保存提示词
                </el-button>
            </div>
        </div>

        <Handle
            id="prompt-source"
            type="source"
            :position="Position.Right"
            :style="{
                background: '#409eff',
                width: '12px',
                height: '12px',
                border: '2px solid white',
                borderRadius: '50%',
                cursor: 'crosshair',
            }"
        />
    </div>

    <el-dialog
        v-model="showSavePromptDialog"
        title="保存自定义提示词"
        width="700px"
        :show-close="true"
        :close-on-click-modal="true"
        :close-on-press-escape="true"
        :append-to-body="true"
        :modal="true"
        :modal-append-to-body="true"
        :center="true"
        class="centered-save-prompt-dialog"
        @close="savePromptName = ''; savePromptDescription = ''"
    >
        <el-form label-width="120px">
            <el-form-item label="提示词名称" required>
                <el-input
                    v-model="savePromptName"
                    placeholder="请输入提示词名称"
                    maxlength="100"
                    show-word-limit
                    size="large"
                />
            </el-form-item>
            <el-form-item label="提示词内容">
                <el-input :value="text" type="textarea" :rows="8" readonly disabled size="large" />
            </el-form-item>
            <el-form-item label="描述（可选）">
                <el-input
                    v-model="savePromptDescription"
                    type="textarea"
                    :rows="4"
                    placeholder="请输入提示词的描述信息"
                    maxlength="200"
                    show-word-limit
                    size="large"
                />
            </el-form-item>
        </el-form>
        <template #footer>
            <el-button size="large" @click="showSavePromptDialog = false">取消</el-button>
            <el-button type="primary" size="large" @click="handleSavePrompt">确认</el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted, inject, nextTick } from 'vue';
import { Handle, Position, type NodeProps, useVueFlow } from '@vue-flow/core';
import { EditPen } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPromptTemplates, createPromptTemplate, type PromptTemplate } from '@/api/prompt';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import type { JSONContent } from '@tiptap/core';
import { Extension, getTextBetween } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

defineEmits<{
    updateNodeInternals: [];
}>();

const BLOCK_SEP = '\n';
const MAX_PLAIN_CHARS = 2000;

type ImageAliasStore = {
    getOrCreateAlias: (imageKey: string) => string;
    getAllAliases: () => { key: string; alias: string }[];
};

type MediaAliasStore = {
    getOrCreateVideoAlias: (key: string) => string;
    getOrCreateAudioAlias: (key: string) => string;
};

const props = defineProps<NodeProps>();
const text = ref(typeof props.data?.text === 'string' ? props.data.text : '');
const promptWidth = ref(360);
const uiTick = ref(0);
const isComposing = ref(false);

const { getEdges, findNode, updateNodeData } = useVueFlow();

const promptTemplates = ref<PromptTemplate[]>([]);
const showPromptSuggestions = ref(false);
const selectedSuggestionIndex = ref(0);

const imageAliasStore = inject<ImageAliasStore | null>('imageAliasStore', null);
const mediaAliasStore = inject<MediaAliasStore | null>('mediaAliasStore', null);
const showAliasSuggestions = ref(false);
const aliasSuggestions = ref<{ key: string; alias: string }[]>([]);
const selectedAliasIndex = ref(0);

const showSavePromptDialog = ref(false);
const savePromptName = ref('');
const savePromptDescription = ref('');

function plainToDoc(plain: string): JSONContent {
    const lines = plain.split('\n');
    const content: JSONContent[] = lines.map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
    }));
    if (content.length === 0) {
        return { type: 'doc', content: [{ type: 'paragraph' }] };
    }
    return { type: 'doc', content };
}

/** 与 getInitialDoc 一致：优先持久化的 TipTap JSON，否则用纯文本重建（用于外部恢复/撤销等） */
function getDocFromNodeData(d: Record<string, unknown> | undefined): JSONContent {
    if (!d) return plainToDoc('');
    const doc = d.promptDoc as JSONContent | undefined;
    if (doc && typeof doc === 'object' && doc.type === 'doc') {
        return doc;
    }
    return plainToDoc(typeof d.text === 'string' ? d.text : '');
}

function getInitialDoc(): JSONContent {
    return getDocFromNodeData(props.data as Record<string, unknown> | undefined);
}

function docPlainLength(doc: Parameters<typeof getTextBetween>[0]): number {
    return getTextBetween(doc, { from: 0, to: doc.content.size }, { blockSeparator: BLOCK_SEP }).length;
}

/** ProseMirror position of the plain-text character at index `charIndex` (0-based). */
function pmPosOfPlainCharIndex(doc: Parameters<typeof getTextBetween>[0], charIndex: number): number {
    if (charIndex <= 0) return 1;
    const max = doc.content.size;
    for (let p = 1; p <= max; p++) {
        const len = getTextBetween(doc, { from: 0, to: p }, { blockSeparator: BLOCK_SEP }).length;
        if (len > charIndex) return p - 1;
    }
    return max;
}

const PromptPlainTextLimit = Extension.create({
    name: 'promptPlainTextLimit',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('promptPlainTextLimit'),
                filterTransaction(tr: Transaction, state: EditorState) {
                    if (!tr.docChanged) return true;
                    const newLen = docPlainLength(tr.doc);
                    if (newLen <= MAX_PLAIN_CHARS) return true;
                    const oldLen = docPlainLength(state.doc);
                    if (newLen > oldLen) return false;
                    return true;
                },
            }),
        ];
    },
});

const RE_AT_MEDIA_REF = /@(?:图|视频|音频)\d+/g;
/** 与旧版镜像高亮一致：行首/空白后的 图1、视频1 等（后跟标点或空白或结尾），不含 @ 前缀 */
const RE_BARE_MEDIA_REF =
    /(^|[\s\u00A0])((?:图|视频|音频)\d+)(?=[\s\u00A0，。、；：!?]|$)/g;

function promptRefDecorationsForDoc(doc: Parameters<typeof getTextBetween>[0]): DecorationSet {
    const decorations: Decoration[] = [];
    doc.descendants((node: PMNode, pos: number) => {
        if (!node.isText || !node.text) return;
        const t = node.text;
        let m: RegExpExecArray | null;
        RE_AT_MEDIA_REF.lastIndex = 0;
        while ((m = RE_AT_MEDIA_REF.exec(t)) !== null) {
            const chunk = m[0] ?? '';
            if (!chunk) continue;
            const from = pos + m.index;
            decorations.push(
                Decoration.inline(from, from + chunk.length, { class: 'prompt-ref-inline' })
            );
        }
        RE_BARE_MEDIA_REF.lastIndex = 0;
        while ((m = RE_BARE_MEDIA_REF.exec(t)) !== null) {
            const full = m[0] ?? '';
            const alias = m[2] ?? '';
            if (!full || !alias) continue;
            const startInNode = m.index + full.indexOf(alias);
            const from = pos + startInNode;
            decorations.push(
                Decoration.inline(from, from + alias.length, { class: 'prompt-ref-inline' })
            );
        }
    });
    return DecorationSet.create(doc, decorations);
}

const PromptRefHighlight = Extension.create({
    name: 'promptRefHighlight',
    addProseMirrorPlugins() {
        const key = new PluginKey('promptRefHighlight');
        return [
            new Plugin({
                key,
                state: {
                    init(_config: object, state: EditorState) {
                        return promptRefDecorationsForDoc(state.doc);
                    },
                    apply(
                        tr: Transaction,
                        value: DecorationSet,
                        _oldState: EditorState,
                        newState: EditorState
                    ) {
                        if (tr.docChanged) {
                            return promptRefDecorationsForDoc(newState.doc);
                        }
                        return value;
                    },
                },
                props: {
                    decorations(state: EditorState) {
                        return key.getState(state);
                    },
                },
            }),
        ];
    },
});

/** 先于 useEditor：避免首帧 onUpdate 调用 syncNodeData 时尚未初始化 */
let syncingExternal = false;

const editor = useEditor({
    extensions: [
        StarterKit.configure({
            codeBlock: false,
            horizontalRule: false,
            heading: { levels: [2, 3] },
        }),
        Placeholder.configure({ placeholder: '请输入提示词...' }),
        PromptPlainTextLimit,
        PromptRefHighlight,
    ],
    content: getInitialDoc(),
    editorProps: {
        attributes: {
            class: 'prompt-tiptap-editor',
            spellcheck: 'false',
        },
        handleDOMEvents: {
            compositionstart: () => {
                isComposing.value = true;
                return false;
            },
            compositionend: () => {
                isComposing.value = false;
                nextTick(() => updateSuggestionUI());
                return false;
            },
            keydown: (_view, event) => handleEditorKeydown(event),
        },
    },
    onUpdate: () => {
        uiTick.value++;
        syncNodeData();
        updateSuggestionUI();
    },
    onSelectionUpdate: () => {
        uiTick.value++;
        updateSuggestionUI();
    },
});

const plainCharCount = computed(() => {
    uiTick.value;
    if (!editor.value) return text.value.length;
    return docPlainLength(editor.value.state.doc);
});

function syncNodeData() {
    if (syncingExternal) return;
    const ed = editor.value;
    if (!ed || isComposing.value) return;
    const plain = ed.getText({ blockSeparator: BLOCK_SEP });
    text.value = plain;
    // 替换 data 引用，确保 Vue Flow 与下游 dreamUpstreamSig 能订阅到 text 变化（仅改 props.data 字段可能不触发）
    updateNodeData(props.id, {
        text: plain,
        promptDoc: ed.getJSON(),
    });
    recomputePromptWidth();
}

function recomputePromptWidth() {
    const len = (text.value || '').length;
    let w = 400;
    if (len > 200) w = 460;
    if (len > 400) w = 520;
    if (len > 800) w = 580;
    if (len > 1200) w = 640;
    promptWidth.value = w;
}

const filteredTemplates = computed(() => {
    const value = text.value || '';
    const slashIndex = value.lastIndexOf('/');
    if (slashIndex === -1) return promptTemplates.value;
    const keyword = value.slice(slashIndex + 1).trim().toLowerCase();
    if (!keyword) return promptTemplates.value;
    return promptTemplates.value.filter(
        (t) =>
            (t.name || '').toLowerCase().includes(keyword) ||
            (t.content || '').toLowerCase().includes(keyword)
    );
});

function run(fn: () => void) {
    fn();
    uiTick.value++;
}

const canUndo = computed(() => {
    uiTick.value;
    return editor.value?.can().undo() ?? false;
});
const canRedo = computed(() => {
    uiTick.value;
    return editor.value?.can().redo() ?? false;
});

const getRelatedResourceAliases = (): { key: string; alias: string }[] => {
    const result: { key: string; alias: string }[] = [];
    const edges = getEdges.value || [];
    if (!Array.isArray(edges) || edges.length === 0) return result;

    if (imageAliasStore) {
        const bridgeNodeIds = new Set<string>();
        for (const edge of edges) {
            if (!edge?.source || !edge?.target) continue;
            if (edge.source !== props.id) continue;
            const targetNode = findNode(edge.target);
            if (targetNode && (targetNode.type === 'dream' || targetNode.type === 'video')) {
                bridgeNodeIds.add(targetNode.id);
            }
        }
        if (bridgeNodeIds.size > 0) {
            const aliasMap: Record<string, string> = {};
            for (const edge of edges) {
                if (!edge?.source || !edge?.target) continue;
                if (!bridgeNodeIds.has(edge.target)) continue;
                const imageNode = findNode(edge.source);
                if (!imageNode || imageNode.type !== 'image') continue;
                const data: Record<string, unknown> = (imageNode.data || {}) as Record<string, unknown>;
                const key =
                    (data.imageKey || data.originalImageUrl || data.imageUrl) as string | undefined;
                if (!key) continue;
                let alias = data.imageAlias as string | undefined;
                if (!alias) {
                    alias = imageAliasStore.getOrCreateAlias(key);
                    data.imageAlias = alias;
                    data.imageKey = key;
                }
                if (!aliasMap[key]) aliasMap[key] = alias;
            }
            for (const [key, alias] of Object.entries(aliasMap)) {
                result.push({ key, alias });
            }
        }
    }

    const videoNodeIds = new Set<string>();
    for (const edge of edges) {
        if (!edge?.source || !edge?.target) continue;
        if (edge.source !== props.id) continue;
        const targetNode = findNode(edge.target);
        if (targetNode && targetNode.type === 'video') {
            videoNodeIds.add(targetNode.id);
        }
    }
    if (videoNodeIds.size > 0) {
        const seenKeys = new Set<string>(result.map((r) => r.key));
        for (const edge of edges) {
            if (!edge?.source || !edge?.target) continue;
            if (!videoNodeIds.has(edge.target)) continue;
            const node = findNode(edge.source);
            if (!node) continue;
            if (node.type !== 'videoRef' && node.type !== 'audioRef') continue;
            const data: Record<string, unknown> = (node.data || {}) as Record<string, unknown>;
            const key = node.id;
            let alias = (data.resourceAlias as string | undefined)?.trim();
            if (!alias && mediaAliasStore) {
                if (node.type === 'videoRef') {
                    alias = mediaAliasStore.getOrCreateVideoAlias(key);
                } else {
                    alias = mediaAliasStore.getOrCreateAudioAlias(key);
                }
                data.resourceAlias = alias;
            }
            if (!alias) continue;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                result.push({ key, alias });
            }
        }
    }
    return result;
};

function plainCursorOffset(ed: NonNullable<typeof editor.value>): number {
    return getTextBetween(ed.state.doc, { from: 0, to: ed.state.selection.from }, {
        blockSeparator: BLOCK_SEP,
    }).length;
}

function updateSuggestionUI() {
    if (isComposing.value || !editor.value) return;
    const ed = editor.value;
    const currentValue = ed.getText({ blockSeparator: BLOCK_SEP });
    const slashIndex = currentValue.lastIndexOf('/');
    const atIndex = currentValue.lastIndexOf('@');
    const cursorOffset = plainCursorOffset(ed);

    if (slashIndex !== -1 && slashIndex > atIndex) {
        showPromptSuggestions.value = filteredTemplates.value.length > 0;
        selectedSuggestionIndex.value = 0;
    } else {
        showPromptSuggestions.value = false;
    }

    if (atIndex !== -1 && cursorOffset >= atIndex + 1) {
        const rawKeyword = currentValue.slice(atIndex + 1, cursorOffset);
        const keyword = rawKeyword.trim();
        const all = getRelatedResourceAliases();
        const list = all.filter((item) => !keyword || item.alias.includes(keyword));
        showAliasSuggestions.value = list.length > 0;
        aliasSuggestions.value = list;
        selectedAliasIndex.value = 0;
    } else {
        showAliasSuggestions.value = false;
        aliasSuggestions.value = [];
    }
}

function handleEditorKeydown(event: KeyboardEvent): boolean {
    if (showAliasSuggestions.value && aliasSuggestions.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedAliasIndex.value = Math.min(
                selectedAliasIndex.value + 1,
                aliasSuggestions.value.length - 1
            );
            return true;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedAliasIndex.value = Math.max(selectedAliasIndex.value - 1, 0);
            return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            const selected = aliasSuggestions.value[selectedAliasIndex.value];
            if (selected) {
                event.preventDefault();
                selectImageAlias(selected);
                return true;
            }
        }
        if (event.key === 'Escape') {
            showAliasSuggestions.value = false;
            return true;
        }
    }

    if (showPromptSuggestions.value && filteredTemplates.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.min(
                selectedSuggestionIndex.value + 1,
                filteredTemplates.value.length - 1
            );
            return true;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
            return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            const selectedTemplate = filteredTemplates.value[selectedSuggestionIndex.value];
            if (selectedTemplate) {
                event.preventDefault();
                selectPromptTemplate(selectedTemplate);
                return true;
            }
        }
        if (event.key === 'Escape') {
            showPromptSuggestions.value = false;
            return true;
        }
    }
    return false;
}

function templateLinesToParagraphs(content: string): JSONContent[] {
    const lines = content.split('\n');
    return lines.map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
    }));
}

function selectPromptTemplate(template: PromptTemplate) {
    const ed = editor.value;
    if (!ed) return;
    const plain = ed.getText({ blockSeparator: BLOCK_SEP });
    const slashIndex = plain.lastIndexOf('/');
    if (slashIndex === -1) return;
    const doc = ed.state.doc;
    const from = pmPosOfPlainCharIndex(doc, slashIndex);
    const to = doc.content.size;
    const nodes = templateLinesToParagraphs(template.content || '');
    ed.chain().focus().insertContentAt({ from, to }, nodes).run();
    showPromptSuggestions.value = false;
    nextTick(() => {
        syncNodeData();
        ed.commands.focus();
    });
}

function selectImageAlias(item: { key: string; alias: string }) {
    const ed = editor.value;
    if (!ed) return;
    const plain = ed.getText({ blockSeparator: BLOCK_SEP });
    const atIndex = plain.lastIndexOf('@');
    if (atIndex === -1) {
        const insert = `@${item.alias}`;
        ed.chain().focus().insertContent(insert).run();
    } else {
        const doc = ed.state.doc;
        const from = pmPosOfPlainCharIndex(doc, atIndex);
        const to = ed.state.selection.from;
        ed.chain().focus().insertContentAt({ from, to }, `@${item.alias}`).run();
    }
    showAliasSuggestions.value = false;
    nextTick(() => {
        syncNodeData();
        ed.commands.focus();
    });
}

const loadPromptTemplates = async () => {
    try {
        const res: { data?: PromptTemplate[] } = await getPromptTemplates();
        promptTemplates.value = res.data || [];
    } catch (error: unknown) {
        console.error('加载提示词模板失败:', error);
    }
};

const handleSavePrompt = async () => {
    if (!savePromptName.value.trim()) {
        ElMessage.warning('请输入提示词名称');
        return;
    }
    if (!text.value.trim()) {
        ElMessage.warning('提示词内容不能为空');
        return;
    }
    try {
        await createPromptTemplate({
            name: savePromptName.value.trim(),
            content: text.value.trim(),
            description: savePromptDescription.value.trim() || undefined,
        });
        ElMessage.success('提示词保存成功！');
        showSavePromptDialog.value = false;
        savePromptName.value = '';
        savePromptDescription.value = '';
        await loadPromptTemplates();
    } catch (error: unknown) {
        console.error('[PromptNode] 保存提示词失败', error);
        if (!(error as { response?: unknown })?.response) {
            ElMessage.error('保存失败，请稍后重试');
        }
    }
};

const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.prompt-node')) {
        showPromptSuggestions.value = false;
        showAliasSuggestions.value = false;
    }
};

watch(
    () => ({
        ed: editor.value,
        fp: JSON.stringify(getDocFromNodeData(props.data as Record<string, unknown> | undefined)),
    }),
    ({ ed }) => {
        if (!ed || syncingExternal) return;
        const nextDoc = getDocFromNodeData(props.data as Record<string, unknown> | undefined);
        const curJson = JSON.stringify(ed.getJSON());
        const nextJson = JSON.stringify(nextDoc);
        if (curJson === nextJson) return;
        syncingExternal = true;
        try {
            ed.commands.setContent(nextDoc);
            text.value = ed.getText({ blockSeparator: BLOCK_SEP });
        } finally {
            syncingExternal = false;
        }
        // setContent 触发的 onUpdate 若仍处在 syncingExternal 内会被跳过，这里补写 text / promptDoc
        syncNodeData();
        uiTick.value++;
    },
    { flush: 'post' }
);

watch(text, (val) => {
    const d = props.data as Record<string, unknown>;
    if (d.text !== val) {
        updateNodeData(props.id, { text: val });
    }
    recomputePromptWidth();
});

loadPromptTemplates();
if (typeof document !== 'undefined') {
    document.addEventListener('click', handleClickOutside);
}

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.prompt-node {
    background: #2d2d2d;
    border: 1px solid #404040;
    border-radius: 30px;
    width: 360px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    position: relative;
}

.nodrag {
    cursor: auto;
}

.prompt-node :deep(.vue-flow__handle) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}

.prompt-node:hover :deep(.vue-flow__handle) {
    opacity: 1;
    pointer-events: auto;
}

.node-header {
    background: #3a3a3f;
    border-bottom: 1px solid #404040;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: bold;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
}

.node-content {
    padding: 10px 16px 14px;
    color: #e0e0e0;
}

.prompt-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
}

.tb-btn {
    min-width: 28px;
    height: 26px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: #c8c8c8;
    background: #3a3a3f;
    border: 1px solid #505050;
    border-radius: 4px;
    cursor: pointer;
}

.tb-btn:hover:not(:disabled) {
    background: #4a4a52;
    color: #fff;
}

.tb-btn.active {
    background: rgba(64, 158, 255, 0.25);
    border-color: #409eff;
    color: #79bbff;
}

.tb-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.prompt-content {
    position: relative;
    background: transparent;
    border-radius: 6px;
    padding: 4px 0 0;
}

.prompt-input-wrap {
    position: relative;
    min-height: 140px;
}

.prompt-editor-host {
    position: relative;
    z-index: 1;
}

.prompt-editor-host :deep(.prompt-tiptap-editor) {
    min-height: 140px;
    max-height: 700px;
    overflow-y: auto;
    padding: 8px 10px;
    font-size: 13px;
    line-height: 1.6;
    color: #e0e0e0;
    background: transparent;
    border: 1px solid #404040;
    border-radius: 8px;
    outline: none;
}

.prompt-editor-host :deep(.prompt-tiptap-editor:focus) {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.prompt-editor-host :deep(.prompt-tiptap-editor p) {
    margin: 0.25em 0;
}

.prompt-editor-host :deep(.prompt-tiptap-editor p.is-editor-empty:first-child::before) {
    color: #888;
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
}

.prompt-editor-host :deep(.prompt-tiptap-editor h2) {
    font-size: 1.15em;
    margin: 0.35em 0 0.2em;
    color: #f0f0f0;
}

.prompt-editor-host :deep(.prompt-tiptap-editor h3) {
    font-size: 1.05em;
    margin: 0.35em 0 0.2em;
    color: #eaeaea;
}

.prompt-editor-host :deep(.prompt-tiptap-editor ul),
.prompt-editor-host :deep(.prompt-tiptap-editor ol) {
    margin: 0.25em 0;
    padding-left: 1.4em;
}

.prompt-editor-host :deep(.prompt-tiptap-editor blockquote) {
    margin: 0.35em 0;
    padding-left: 0.75em;
    border-left: 3px solid #409eff;
    color: #c8c8c8;
}

/* @图1、视频/音频别名等引用：与旧版 .prompt-ref 一致 */
.prompt-editor-host :deep(.prompt-tiptap-editor .prompt-ref-inline) {
    color: var(--color-primary, #409eff);
}

.prompt-meta {
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
}

.char-count {
    font-size: 11px;
    color: #888;
}

.prompt-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #252525;
    border: 1px solid #404040;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.6);
    z-index: 1000;
    max-height: 240px;
    overflow-y: auto;
    margin-top: 6px;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    transition: background-color 0.15s;
}

.suggestion-item:hover,
.suggestion-item.active {
    background-color: #333333;
}

.suggestion-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #409eff;
    flex-shrink: 0;
}

.suggestion-name {
    font-size: 13px;
    color: #b0b0b0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.prompt-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
}

.save-prompt-btn {
    font-size: 12px;
    padding: 4px 12px;
    height: auto;
}

.centered-save-prompt-dialog :deep(.el-dialog) {
    margin: 0 !important;
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    max-height: 90vh !important;
    display: flex !important;
    flex-direction: column !important;
}
</style>
