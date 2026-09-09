<template>
  <div class="my-skills-panel nodrag nopan">
    <div class="head">
      <span class="title">我的 Skill</span>
      <el-upload :show-file-list="false" accept=".zip,.md" :http-request="onUpload" :disabled="loading">
        <el-button size="small" type="primary" :loading="loading">上传（仅自己可见）</el-button>
      </el-upload>
    </div>
    <p class="hint">支持市场下载的 zip / SKILL.md。私有 Skill 不会对其他用户可见。</p>
    <el-table :data="mine" size="small" v-loading="loading" max-height="280">
      <el-table-column prop="name" label="名称" min-width="100" show-overflow-tooltip />
      <el-table-column prop="description" label="描述" min-width="140" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="90" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="onDelete(row)">删除</el-button>
          <el-button
            link
            size="small"
            @click="onToggle(row)"
          >{{ row.visibility === 'disabled' ? '启用' : '停用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="sub">全员 Skill</div>
    <el-table :data="globals" size="small" max-height="200">
      <el-table-column prop="name" label="名称" min-width="100" show-overflow-tooltip />
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  deleteSkill,
  importPrivateSkill,
  listSkills,
  patchSkill,
  type SkillListItem,
} from '@/api/skill';

const loading = ref(false);
const skills = ref<SkillListItem[]>([]);

const mine = computed(() =>
  skills.value.filter((s) => s.group === 'mine' || (s.visibility === 'private' || s.visibility === 'disabled'))
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

const onUpload = async (opt: any) => {
  loading.value = true;
  try {
    await importPrivateSkill(opt.file as File);
    ElMessage.success('已导入为私有 Skill');
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
  await refresh();
};

onMounted(refresh);

defineExpose({ refresh });
</script>

<style scoped>
.my-skills-panel {
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  color: #ddd;
  min-width: 360px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.title {
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: #888;
  margin: 0 0 8px;
}
.sub {
  margin: 12px 0 6px;
  font-size: 13px;
  color: #aaa;
}
</style>
