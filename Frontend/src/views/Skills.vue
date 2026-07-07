<template>
  <div class="skills-page">
    <div class="header-section">
      <el-button circle class="back-button" @click="router.push('/')">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="header-text">
        <h1 class="page-title">Skill 管理</h1>
        <p class="page-subtitle">支持 Agent Skills 开放标准（agentskills.io），可从网络/GitHub 安装，含智能预处理</p>
      </div>
    </div>

    <el-card class="guide-card" shadow="never">
      <div class="guide-title">Skill 是什么？</div>
      <p class="guide-text">
        Skill 分两种：<strong>纯文本</strong>（直接拼接到提示词）和 <strong>Agent Skills 标准 SKILL.md</strong>（遵循
        <a href="https://agentskills.io" target="_blank" rel="noopener">agentskills.io</a>，解析 frontmatter + Instructions，默认 Gemini 智能预处理）。
        可从 GitHub 目录、SKILL.md 直链或 ZIP 安装；也支持本地文件导入。
        <strong>本平台仅支持生图/生视频/分镜相关 Skill</strong>，PDF、代码、办公文档类 Skill 将在导入时被拦截。
      </p>
      <div class="guide-limits">
        <span>名称 ≤ {{ SKILL_LIMITS.NAME_MAX }} 字</span>
        <span>指令 ≤ {{ SKILL_LIMITS.CONTENT_MAX.toLocaleString() }} 字</span>
        <span>单次导入 ≤ {{ SKILL_LIMITS.IMPORT_BATCH_MAX }} 条</span>
        <span>单文件 ≤ 5MB · ZIP ≤ 10MB</span>
        <span>支持 .json / .md / .txt / .zip</span>
      </div>
    </el-card>

    <el-card v-loading="builtinLoading" class="guide-card builtin-card" shadow="never">
      <div class="guide-title">内置生成 Skill</div>
      <div v-for="item in builtinSkills" :key="item.slug" class="builtin-item">
        <div class="builtin-meta">
          <strong>{{ item.name }}</strong>
          <el-tag size="small" type="success" effect="plain">内置</el-tag>
          <p>{{ item.description }}</p>
        </div>
        <el-button size="small" type="primary" :loading="installingSlug === item.slug" @click="handleInstallBuiltin(item.slug)">
          添加到我的库
        </el-button>
      </div>
      <p class="builtin-tip">也可在工作流分镜节点选择「四格漫画」模式，无需先添加也会自动应用内置规则。</p>
    </el-card>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索名称或内容"
        clearable
        style="width: 240px"
        @keyup.enter="loadSkills"
        @clear="loadSkills"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select v-model="scopeFilter" placeholder="适用范围" clearable style="width: 150px" @change="loadSkills">
        <el-option label="生图 + 生视频" value="both" />
        <el-option label="仅生图" value="image" />
        <el-option label="仅生视频" value="video" />
      </el-select>
      <el-button @click="loadSkills">刷新</el-button>
      <el-button type="primary" @click="openCreateDialog">新建 Skill</el-button>
      <el-button @click="openRemoteDialog">从网络安装</el-button>
      <el-button @click="triggerImport">导入文件</el-button>
      <el-button :disabled="!skills.length" @click="exportAll">导出 JSON</el-button>
      <input
        ref="fileInputRef"
        type="file"
        :accept="SKILL_IMPORT_ACCEPT"
        class="hidden-file-input"
        @change="handleImportFile"
      />
    </div>

    <el-table v-loading="loading" :data="skills" border class="skills-table" table-layout="fixed">
      <el-table-column prop="name" label="名称" min-width="120" show-overflow-tooltip />
      <el-table-column prop="format" label="格式" width="108">
        <template #default="{ row }">
          <el-tag size="small" :type="isAgentSkillFormat(row.format) ? 'success' : 'info'" effect="plain">
            {{ formatLabel(row.format || 'plain') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="apply_mode" label="应用方式" min-width="120">
        <template #default="{ row }">
          {{ applyModeLabel(row.apply_mode || 'merge') }}
        </template>
      </el-table-column>
      <el-table-column prop="scope" label="适用范围" min-width="120">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ scopeLabel(row.scope) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="content" label="指令内容" min-width="240" show-overflow-tooltip />
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
      <el-table-column prop="updated_at" label="更新时间" width="168" show-overflow-tooltip :formatter="formatTableDateTime" />
      <el-table-column label="操作" width="248" fixed="right" class-name="skills-col-actions">
        <template #default="{ row }">
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button size="small" @click="exportOne(row)">导出</el-button>
          <el-button
            v-if="isAgentSkillFormat(row.format)"
            size="small"
            @click="exportOneAsMd(row)"
          >
            导出 MD
          </el-button>
          <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑 Skill' : '新建 Skill'"
      width="720px"
      destroy-on-close
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="88px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="例如：电影感镜头" />
        </el-form-item>
        <el-form-item label="格式" prop="format">
          <el-select v-model="form.format" style="width: 100%" @change="onFormFormatChange">
            <el-option label="纯文本 Skill" value="plain" />
            <el-option label="Agent Skills 标准 SKILL.md" value="agent_skill" />
          </el-select>
        </el-form-item>
        <el-form-item label="应用方式" prop="apply_mode">
          <el-select v-model="form.apply_mode" style="width: 100%">
            <el-option label="直接合并到提示词" value="merge" />
            <el-option label="Gemini 智能预处理（推荐标准 Skill）" value="preprocess" />
          </el-select>
        </el-form-item>
        <el-form-item label="适用范围" prop="scope">
          <el-select v-model="form.scope" style="width: 100%">
            <el-option label="生图 + 生视频" value="both" />
            <el-option label="仅生图" value="image" />
            <el-option label="仅生视频" value="video" />
          </el-select>
        </el-form-item>
        <el-form-item label="指令内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="10"
            :maxlength="SKILL_LIMITS.CONTENT_MAX"
            show-word-limit
            placeholder="Agent Skills 标准请写 Instructions 段落内容；纯文本 Skill 写风格/约束即可"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选，方便在列表里识别用途"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importPreviewVisible" title="确认导入" width="880px" destroy-on-close>
      <p class="import-summary">
        即将导入 {{ importPreviewItems.length }} 个 Skill（重复名称也会新建，不会覆盖已有项）
        <span v-if="importHasBlocked" class="import-warn"> · 存在不可用的 Skill，请移除后再导入</span>
      </p>
      <el-table :data="importPreviewItems" border max-height="360" size="small" class="skills-table">
        <el-table-column label="名称" min-width="120">
          <template #default="{ row }">{{ row.skill.name }}</template>
        </el-table-column>
        <el-table-column label="格式" min-width="96">
          <template #default="{ row }">{{ formatLabel(row.skill.format || 'plain') }}</template>
        </el-table-column>
        <el-table-column label="可用性" min-width="96">
          <template #default="{ row }">
            <el-tag size="small" :type="usabilityTagType(row.usability)" effect="plain">
              {{ usabilityLabel(row.usability) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="200">
          <template #default="{ row }">{{ row.usability.reason }}</template>
        </el-table-column>
        <el-table-column label="内容预览" min-width="200">
          <template #default="{ row }">{{ row.skill.content }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="importPreviewVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="importHasBlocked" @click="confirmImport">
          确认导入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="remoteDialogVisible" title="从网络安装 Skill" width="820px" destroy-on-close @open="onRemoteDialogOpen">
      <el-tabs v-model="remoteTab">
        <el-tab-pane label="URL 安装" name="url">
          <p class="remote-hint">
            支持 GitHub Skill 目录（如 <code>github.com/anthropics/skills/tree/main/skills/frontend-design</code>）、
            SKILL.md 直链或 .zip 地址。PDF/文档/代码类 Skill 将被拒绝导入。
          </p>
          <el-input
            v-model="remoteUrl"
            placeholder="粘贴 Skill URL"
            clearable
            @keyup.enter="previewRemote"
          />
          <div class="remote-actions">
            <el-button :loading="remotePreviewing" @click="previewRemote">预览</el-button>
            <el-button type="primary" :loading="remoteImporting" :disabled="!remoteUrl.trim() || remoteHasBlocked" @click="importRemoteDirect">
              直接安装
            </el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="技能市场" name="market">
          <div v-loading="marketLoading" class="market-panel">
            <p v-if="marketSource" class="market-source-desc">
              {{ marketSource.description }}
              <a :href="marketSource.homepage" target="_blank" rel="noopener">查看仓库</a>
            </p>
            <el-table :data="marketItems" border size="small" max-height="360" class="skills-table">
              <el-table-column prop="name" label="名称" min-width="140" />
              <el-table-column prop="description" label="描述" min-width="280" />
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" type="primary" :loading="remoteImporting && installingUrl === row.installUrl" @click="installFromMarket(row.installUrl)">
                    安装
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>

      <div v-if="remotePreviewItems.length" class="remote-preview">
        <p class="import-summary">
          预览 {{ remotePreviewItems.length }} 个 Skill
          <span v-if="remoteHasBlocked" class="import-warn"> · 含不可用项，无法安装</span>
        </p>
        <el-table :data="remotePreviewItems" border max-height="240" size="small" class="skills-table">
          <el-table-column label="名称" min-width="120">
            <template #default="{ row }">{{ row.skill.name }}</template>
          </el-table-column>
          <el-table-column label="可用性" min-width="96">
            <template #default="{ row }">
              <el-tag size="small" :type="usabilityTagType(row.usability)" effect="plain">
                {{ usabilityLabel(row.usability) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="200">
            <template #default="{ row }">{{ row.usability.reason }}</template>
          </el-table-column>
          <el-table-column label="内容预览" min-width="200">
            <template #default="{ row }">{{ row.skill.content }}</template>
          </el-table-column>
        </el-table>
        <div class="remote-actions">
          <el-button type="primary" :loading="remoteImporting" :disabled="remoteHasBlocked" @click="confirmRemoteImport">
            确认安装
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { ArrowLeft, Search } from '@element-plus/icons-vue';
import {
  createGenerationSkill,
  deleteGenerationSkill,
  getGenerationSkills,
  importGenerationSkills,
  checkSkillsUsability,
  updateGenerationSkill,
  previewRemoteSkills,
  importRemoteSkills,
  getSkillMarketplace,
  getSkillMarketplaceItems,
  getBuiltinSkills,
  installBuiltinSkill,
  isAgentSkillFormat,
  SKILL_LIMITS,
  type GenerationSkill,
  type GenerationSkillScope,
  type GenerationSkillFormat,
  type GenerationSkillApplyMode,
  type SkillMarketplaceSource,
  type SkillMarketplaceItem,
  type BuiltinGenerationSkill,
  type SkillImportPreviewItem,
} from '@/api/skill';
import { usabilityLabel, usabilityTagType, hasBlockedSkills } from '@/utils/skill-usability';
import { formatIsoToYmdHms } from '@/utils/date';
import {
  parseSkillFile,
  scopeLabel,
  formatLabel,
  applyModeLabel,
  exportSkillAsAgentMarkdown,
  SKILL_IMPORT_ACCEPT,
  type ParsedSkillDraft,
} from '@/utils/skill-import';

const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const importing = ref(false);
const skills = ref<GenerationSkill[]>([]);
const keyword = ref('');
const scopeFilter = ref<GenerationSkillScope | ''>('');
const dialogVisible = ref(false);
const importPreviewVisible = ref(false);
const remoteDialogVisible = ref(false);
const remoteTab = ref('url');
const remoteUrl = ref('');
const remotePreviewItems = ref<SkillImportPreviewItem[]>([]);
const remotePreviewing = ref(false);
const remoteImporting = ref(false);
const installingUrl = ref('');
const marketLoading = ref(false);
const marketSource = ref<SkillMarketplaceSource | null>(null);
const marketItems = ref<SkillMarketplaceItem[]>([]);
const builtinSkills = ref<BuiltinGenerationSkill[]>([]);
const builtinLoading = ref(false);
const installingSlug = ref('');
const editingId = ref<number | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const importPreviewItems = ref<SkillImportPreviewItem[]>([]);
const importHasBlocked = computed(() => hasBlockedSkills(importPreviewItems.value));
const remoteHasBlocked = computed(() => hasBlockedSkills(remotePreviewItems.value));
const formRef = ref<FormInstance>();

const form = reactive({
  name: '',
  content: '',
  scope: 'both' as GenerationSkillScope,
  description: '',
  format: 'plain' as GenerationSkillFormat,
  apply_mode: 'merge' as GenerationSkillApplyMode,
});

const onFormFormatChange = (f: GenerationSkillFormat) => {
  if (isAgentSkillFormat(f)) form.apply_mode = 'preprocess';
};

const formRules: FormRules = {
  name: [
    { required: true, message: '请输入名称', trigger: 'blur' },
    { max: SKILL_LIMITS.NAME_MAX, message: `名称不能超过 ${SKILL_LIMITS.NAME_MAX} 字`, trigger: 'blur' },
  ],
  content: [
    { required: true, message: '请输入指令内容', trigger: 'blur' },
    { max: SKILL_LIMITS.CONTENT_MAX, message: `内容不能超过 ${SKILL_LIMITS.CONTENT_MAX} 字`, trigger: 'blur' },
  ],
  scope: [{ required: true, message: '请选择适用范围', trigger: 'change' }],
};

const formatTableDateTime = (_row: unknown, _column: unknown, cellValue: unknown) =>
  formatIsoToYmdHms(cellValue);

const loadSkills = async () => {
  loading.value = true;
  try {
    let list: GenerationSkill[] = [];
    const scope = scopeFilter.value || undefined;
    if (keyword.value.trim()) {
      const res = await getGenerationSkills(scope);
      const all = (res as { data?: GenerationSkill[] }).data || [];
      const kw = keyword.value.trim().toLowerCase();
      list = all.filter(
        (s) => s.name.toLowerCase().includes(kw) || s.content.toLowerCase().includes(kw)
      );
    } else {
      const res = await getGenerationSkills(scope);
      list = (res as { data?: GenerationSkill[] }).data || [];
    }
    skills.value = list;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  editingId.value = null;
  form.name = '';
  form.content = '';
  form.scope = 'both';
  form.description = '';
  form.format = 'plain';
  form.apply_mode = 'merge';
};

const openCreateDialog = () => {
  resetForm();
  dialogVisible.value = true;
};

const openEditDialog = (row: GenerationSkill) => {
  editingId.value = row.id;
  form.name = row.name;
  form.content = row.content;
  form.scope = row.scope;
  form.description = row.description || '';
  form.format = row.format || 'plain';
  form.apply_mode = row.apply_mode || (isAgentSkillFormat(row.format) ? 'preprocess' : 'merge');
  dialogVisible.value = true;
};

const handleSave = async () => {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      content: form.content.trim(),
      scope: form.scope,
      description: form.description.trim() || undefined,
      format: form.format,
      apply_mode: form.apply_mode,
    };
    if (editingId.value) {
      await updateGenerationSkill(editingId.value, payload);
      ElMessage.success('更新成功');
    } else {
      await createGenerationSkill(payload);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    await loadSkills();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (row: GenerationSkill) => {
  try {
    await ElMessageBox.confirm(`确定删除 Skill「${row.name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await deleteGenerationSkill(row.id);
    ElMessage.success('已删除');
    await loadSkills();
  } catch {
    // cancelled
  }
};

const triggerImport = () => {
  fileInputRef.value?.click();
};

const handleImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const drafts = await parseSkillFile(file);
    const res = await checkSkillsUsability(drafts);
    importPreviewItems.value = (res as { data?: SkillImportPreviewItem[] }).data || [];
    importPreviewVisible.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '文件解析失败');
  }
};

const confirmImport = async () => {
  if (!importPreviewItems.value.length || importHasBlocked.value) return;
  importing.value = true;
  try {
    const skillsToImport = importPreviewItems.value.map((x) => x.skill);
    const res = await importGenerationSkills(skillsToImport);
    const count = (res as { data?: GenerationSkill[] }).data?.length ?? skillsToImport.length;
    ElMessage.success(`成功导入 ${count} 个 Skill`);
    importPreviewVisible.value = false;
    importPreviewItems.value = [];
    await loadSkills();
  } catch (error: any) {
    ElMessage.error(error?.message || '导入失败');
  } finally {
    importing.value = false;
  }
};

const downloadText = (filename: string, text: string, mime = 'text/plain;charset=utf-8') => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const downloadJson = (filename: string, data: unknown) => {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
};

const exportAll = () => {
  const payload = skills.value.map((s) => ({
    name: s.name,
    content: s.content,
    scope: s.scope,
    description: s.description || undefined,
    format: s.format,
    apply_mode: s.apply_mode,
    metadata_json: s.metadata_json,
    source_path: s.source_path,
  }));
  downloadJson(`skills-export-${Date.now()}.json`, { skills: payload });
};

const exportOne = (row: GenerationSkill) => {
  downloadJson(`${row.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'skill'}.json`, {
    name: row.name,
    content: row.content,
    scope: row.scope,
    description: row.description || undefined,
    format: row.format,
    apply_mode: row.apply_mode,
    metadata_json: row.metadata_json,
    source_path: row.source_path,
  });
};

const exportOneAsMd = (row: GenerationSkill) => {
  const md = exportSkillAsAgentMarkdown(row);
  downloadText(`${row.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'skill'}-SKILL.md`, md, 'text/markdown;charset=utf-8');
};

const openRemoteDialog = () => {
  remoteUrl.value = '';
  remotePreviewItems.value = [];
  remoteTab.value = 'url';
  remoteDialogVisible.value = true;
};

const loadMarketplace = async () => {
  marketLoading.value = true;
  try {
    const sourcesRes = await getSkillMarketplace();
    const sources = (sourcesRes as { data?: SkillMarketplaceSource[] }).data || [];
    marketSource.value = sources[0] || null;
    if (marketSource.value) {
      const itemsRes = await getSkillMarketplaceItems(marketSource.value.id);
      marketItems.value = (itemsRes as { data?: SkillMarketplaceItem[] }).data || [];
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载技能市场失败');
  } finally {
    marketLoading.value = false;
  }
};

const onRemoteDialogOpen = () => {
  if (remoteTab.value === 'market' && !marketItems.value.length) {
    loadMarketplace();
  }
};

const previewRemote = async () => {
  const url = remoteUrl.value.trim();
  if (!url) {
    ElMessage.warning('请输入 URL');
    return;
  }
  remotePreviewing.value = true;
  try {
    const res = await previewRemoteSkills(url);
    remotePreviewItems.value = (res as { data?: SkillImportPreviewItem[] }).data || [];
    if (!remotePreviewItems.value.length) {
      ElMessage.warning('未解析到 Skill');
    } else if (remoteHasBlocked.value) {
      ElMessage.warning('预览中包含不可用于生图/生视频的 Skill');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '预览失败');
  } finally {
    remotePreviewing.value = false;
  }
};

const confirmRemoteImport = async () => {
  const url = remoteUrl.value.trim();
  if (!url || remoteHasBlocked.value) return;
  remoteImporting.value = true;
  try {
    const res = await importRemoteSkills(url);
    const count = (res as { data?: GenerationSkill[] }).data?.length ?? remotePreviewItems.value.length;
    ElMessage.success(`成功安装 ${count} 个 Skill`);
    remoteDialogVisible.value = false;
    remotePreviewItems.value = [];
    await loadSkills();
  } catch (error: any) {
    ElMessage.error(error?.message || '安装失败');
  } finally {
    remoteImporting.value = false;
  }
};

const importRemoteDirect = async () => {
  if (remoteHasBlocked.value) {
    ElMessage.warning('当前 URL 解析出的 Skill 不可用，请更换链接');
    return;
  }
  remotePreviewItems.value = [];
  await confirmRemoteImport();
};

const installFromMarket = async (url: string) => {
  installingUrl.value = url;
  remoteImporting.value = true;
  try {
    const res = await importRemoteSkills(url);
    const count = (res as { data?: GenerationSkill[] }).data?.length ?? 1;
    ElMessage.success(`成功安装 ${count} 个 Skill`);
    await loadSkills();
  } catch (error: any) {
    ElMessage.error(error?.message || '安装失败');
  } finally {
    remoteImporting.value = false;
    installingUrl.value = '';
  }
};

watch(remoteTab, (tab) => {
  if (tab === 'market' && remoteDialogVisible.value && !marketItems.value.length) {
    loadMarketplace();
  }
});

onMounted(() => {
  loadSkills();
  loadBuiltinSkills();
});

const loadBuiltinSkills = async () => {
  builtinLoading.value = true;
  try {
    const res = await getBuiltinSkills();
    builtinSkills.value = (res as { data?: BuiltinGenerationSkill[] }).data || [];
  } catch {
    // optional
  } finally {
    builtinLoading.value = false;
  }
};

const handleInstallBuiltin = async (slug: string) => {
  installingSlug.value = slug;
  try {
    await installBuiltinSkill(slug);
    ElMessage.success('已添加到 Skill 库');
    await loadSkills();
  } catch (error: any) {
    ElMessage.error(error?.message || '添加失败');
  } finally {
    installingSlug.value = '';
  }
};
</script>

<style scoped>
.skills-page {
  min-height: 100vh;
  padding: 24px 32px 40px;
  width: 100%;
  max-width: none;
  margin: 0;
  box-sizing: border-box;
}

.header-section {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;
}

.header-text {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-main, #303133);
}

.page-subtitle {
  margin: 6px 0 0;
  color: var(--text-muted, #909399);
  font-size: 14px;
}

.guide-card {
  margin-bottom: 20px;
  background: var(--app-bg-sub, #fafafa);
}

.guide-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.guide-text {
  margin: 0 0 12px;
  color: var(--text-soft, #606266);
  line-height: 1.6;
  font-size: 14px;
}

.guide-limits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 12px;
  color: var(--text-muted, #909399);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.skills-table {
  width: 100%;
}

.skills-table :deep(.el-table__body-wrapper),
.skills-table :deep(.el-table__header-wrapper) {
  overflow: hidden;
}

.skills-table :deep(.el-table__body .cell),
.skills-table :deep(.el-table__header .cell) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skills-table :deep(.skills-col-actions .cell) {
  overflow: visible;
  white-space: nowrap;
}

.skills-table :deep(.el-table-fixed-column--right) {
  background-color: var(--el-table-tr-bg-color, var(--el-bg-color));
  z-index: 2;
}

.hidden-file-input {
  display: none;
}

.import-summary {
  margin: 0 0 12px;
  color: var(--text-soft, #606266);
  font-size: 14px;
}

.import-warn {
  color: var(--el-color-danger, #f56c6c);
}

.remote-hint {
  margin: 0 0 12px;
  color: var(--text-soft, #606266);
  font-size: 13px;
  line-height: 1.6;
}

.remote-hint code {
  font-size: 12px;
  background: var(--app-bg-sub, #f5f5f5);
  padding: 2px 6px;
  border-radius: 4px;
}

.remote-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.remote-preview {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
}

.market-source-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-soft, #606266);
}

.market-panel {
  min-height: 120px;
}

.builtin-card {
  margin-bottom: 20px;
}

.builtin-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter, #ebeef5);
  flex-wrap: wrap;
}

.builtin-meta {
  flex: 1;
  min-width: 240px;
}

.builtin-item:last-of-type {
  border-bottom: none;
}

.builtin-meta p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-soft, #606266);
  line-height: 1.5;
}

.builtin-tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted, #909399);
}

@media (max-width: 768px) {
  .skills-page {
    padding: 16px;
  }
}
</style>
