<template>
  <div class="my-skills-panel nodrag nopan">
    <div class="head">
      <span class="title">我的 Skill</span>
      <el-upload :show-file-list="false" accept=".zip,.md" :http-request="onUpload" :disabled="loading">
        <el-button size="small" type="primary" :loading="loading">上传（仅自己可见）</el-button>
      </el-upload>
    </div>
    <p class="hint">支持市场 zip / SKILL.md。上传后自动评级；建议对 B/C 级点「生成适配版」后再用。</p>
    <el-table :data="mine" size="small" v-loading="loading" max-height="320">
      <el-table-column label="名称" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ skillDisplayLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="评级" width="88">
        <template #default="{ row }">
          <el-tag v-if="row.compat_grade" size="small" :type="compatGradeTagType(row.compat_grade)">
            {{ row.compat_grade }}
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="适配" width="56">
        <template #default="{ row }">{{ row.has_adapted ? '有' : '无' }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link size="small" @click="showCompat(row)">缺口</el-button>
          <el-button link type="primary" size="small" :loading="adaptId === row.id" @click="onAdapt(row)">
            适配
          </el-button>
          <el-button link type="danger" size="small" @click="onDelete(row)">删除</el-button>
          <el-button link size="small" @click="onToggle(row)">
            {{ row.visibility === 'disabled' ? '启用' : '停用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="sub">全员 Skill</div>
    <el-table :data="globals" size="small" max-height="200">
      <el-table-column label="名称" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ skillDisplayLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="评级" width="88">
        <template #default="{ row }">
          <el-tag v-if="row.compat_grade" size="small" :type="compatGradeTagType(row.compat_grade)">
            {{ row.compat_grade }}
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  adaptSkill,
  compatGradeTagType,
  deleteSkill,
  importPrivateSkill,
  listSkills,
  patchSkill,
  skillDisplayLabel,
  type SkillListItem,
} from '@/api/skill';

const loading = ref(false);
const adaptId = ref<number | null>(null);
const skills = ref<SkillListItem[]>([]);

const mine = computed(() =>
  skills.value.filter((s) => s.group === 'mine' || s.visibility === 'private' || s.visibility === 'disabled')
);
const globals = computed(() => skills.value.filter((s) => s.group === 'global' || s.visibility === 'global'));

const refresh = async () => {
  loading.value = true;
  try {
    const res: any = await listSkills();
    skills.value = res?.data?.skills || res?.skills || [];
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const showCompat = (row: SkillListItem) => {
  const gaps = row.compat_report?.gaps || [];
  const lines = [
    `评级：${row.compat_grade || '—'} ${row.compat_report?.grade_label || ''}`,
    row.compat_report?.summary || '',
    row.has_adapted ? '已有适配版（Agent 优先使用）' : '尚未生成适配版',
    '',
    ...gaps.map((g) => `• [${g.severity}] ${g.message}`),
  ].filter(Boolean);
  ElMessageBox.alert(lines.join('\n') || '暂无报告', skillDisplayLabel(row), { confirmButtonText: '知道了' });
};

const onAdapt = async (row: SkillListItem) => {
  adaptId.value = row.id;
  try {
    const res: any = await adaptSkill(row.id);
    const report = res?.data?.report;
    ElMessage.success(`适配完成：${report?.grade || ''} ${report?.grade_label || ''}`);
    if (report?.gaps?.length) {
      await ElMessageBox.alert(
        report.gaps.map((g: any) => `• [${g.severity}] ${g.message}`).join('\n'),
        '不可适配 / 需注意项',
        { confirmButtonText: '知道了' }
      );
    }
    await refresh();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '适配失败');
  } finally {
    adaptId.value = null;
  }
};

const onUpload = async (opt: any) => {
  loading.value = true;
  try {
    const res: any = await importPrivateSkill(opt.file as File);
    const grade = res?.data?.compat_grade;
    ElMessage.success(grade ? `已导入（评级 ${grade}）` : '已导入为私有 Skill');
    await refresh();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '导入失败');
  } finally {
    loading.value = false;
  }
};

const onDelete = async (row: SkillListItem) => {
  await ElMessageBox.confirm(`删除 Skill「${row.name}」？`, '确认', { type: 'warning' });
  await deleteSkill(row.id);
  ElMessage.success('已删除');
  await refresh();
};

const onToggle = async (row: SkillListItem) => {
  const visibility = row.visibility === 'disabled' ? 'private' : 'disabled';
  await patchSkill(row.id, { visibility });
  ElMessage.success('已更新');
  await refresh();
};

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.my-skills-panel {
  padding: 4px 2px 12px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.title {
  font-weight: 600;
}
.hint {
  color: #888;
  font-size: 12px;
  margin: 0 0 10px;
  line-height: 1.4;
}
.sub {
  margin: 14px 0 8px;
  font-size: 13px;
  color: #aaa;
}
</style>
