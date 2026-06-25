<template>
  <div class="creative-square-container">
    <div class="section-header">
      <h3 class="section-title">创意广场</h3>
    </div>

    <div v-loading="loading" class="member-grid">
      <div
        v-for="member in members"
        :key="member.user_id"
        :ref="(el) => setCardRef(member.user_id, el as HTMLElement | null)"
        class="member-card"
        :class="{ 'member-card--active': hoveredUserId === member.user_id && showPopup }"
        @mouseenter="handleCardEnter(member)"
        @mouseleave="handleCardLeave"
        @click="openProject(member.latest_project, member.user_id)"
      >
        <div class="member-preview">
          <img
            v-if="member.latest_project.cover_image"
            :src="getImageUrl(member.latest_project.cover_image)"
            alt="项目封面"
            loading="lazy"
            @error="handleImageError"
          />
          <div v-else class="member-placeholder">
            <el-icon :size="48"><Picture /></el-icon>
          </div>
        </div>
        <div class="member-info">
          <div class="member-canvas-title">{{ member.username }}的画布</div>
          <div class="project-meta">最近更新: {{ formatDate(member.latest_project.updated_at) }}</div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="popup-fade">
        <div
          v-if="activeMember && showPopup"
          class="project-popup"
          :style="popupStyle"
          @mouseenter="handlePopupEnter"
          @mouseleave="handlePopupLeave"
          @click.stop
        >
          <div v-if="projectsLoading[activeMember.user_id]" class="popup-loading">
            <el-icon class="is-loading"><Loading /></el-icon>
          </div>
          <div v-else-if="(memberProjects[activeMember.user_id] || []).length === 0" class="popup-empty">
            暂无项目
          </div>
          <div v-else class="popup-grid-scroll">
            <div class="popup-grid">
              <div
                v-for="project in memberProjects[activeMember.user_id]"
                :key="`${project.source}-${project.id}`"
                class="popup-item"
                :title="project.name"
                @click="openProject(project, activeMember.user_id)"
              >
                <img
                  v-if="project.cover_image"
                  :src="getImageUrl(project.cover_image)"
                  alt=""
                  loading="lazy"
                  @error="handlePopupImageError"
                />
                <div v-else class="popup-item-placeholder">
                  <el-icon><Picture /></el-icon>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="members.length === 0 && !loading" class="empty-state">
      <el-icon :size="64" class="empty-icon"><Document /></el-icon>
      <p>暂无成员项目</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { Picture, Document, Loading } from '@element-plus/icons-vue';
import {
  getCreativeSquareMembers,
  getCreativeSquareMemberProjects,
  type CreativeSquareMember,
  type CreativeSquareMemberProject,
  type CreativeSquareLatestProject,
} from '@/api/workflow';
import { getUploadUrl } from '@/utils/image-loader';
import { useUserStore } from '@/store/user';
import { onWorkflowListChanged } from '@/utils/workflow-list-events';

const POLL_INTERVAL_MS = 30_000;
const POPUP_HIDE_DELAY_MS = 280;
const POPUP_GAP = 10;

const router = useRouter();
const userStore = useUserStore();

const loading = ref(false);
const members = ref<CreativeSquareMember[]>([]);
const memberProjects = ref<Record<number, CreativeSquareMemberProject[]>>({});
const projectsLoading = ref<Record<number, boolean>>({});
const hoveredUserId = ref<number | null>(null);
const activeMember = ref<CreativeSquareMember | null>(null);
const showPopup = ref(false);
const popupHovering = ref(false);
const popupAnchor = ref({ left: 0, top: 0 });

const cardRefs = new Map<number, HTMLElement>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let hidePopupTimer: ReturnType<typeof setTimeout> | null = null;

const popupStyle = computed(() => ({
  left: `${popupAnchor.value.left}px`,
  top: `${popupAnchor.value.top}px`,
}));

const setCardRef = (userId: number, el: HTMLElement | null) => {
  if (el) cardRefs.set(userId, el);
  else cardRefs.delete(userId);
};

const getImageUrl = (url: string) => getUploadUrl(url);

const handleImageError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) target.style.display = 'none';
};

const handlePopupImageError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) target.style.display = 'none';
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${minutes}`;
};

const isOwnUser = (userId: number) => {
  const myId = userStore.userInfo?.id;
  return myId != null && Number(myId) === userId;
};

const updatePopupPosition = () => {
  const userId = activeMember.value?.user_id;
  if (userId == null) return;
  const el = cardRefs.get(userId);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  popupAnchor.value = {
    left: rect.left + rect.width / 2,
    top: rect.top - POPUP_GAP,
  };
};

const openProject = (
  project: CreativeSquareLatestProject | CreativeSquareMemberProject,
  ownerUserId: number
) => {
  const own = isOwnUser(ownerUserId);
  if (own) {
    if (project.source === 'template') {
      router.push(`/workflow?id=${project.id}`);
    } else {
      router.push(`/workflow?historyId=${project.id}`);
    }
  } else if (project.source === 'template') {
    router.push(`/workflow?forkTemplate=${project.id}`);
  } else {
    router.push(`/workflow?forkHistory=${project.id}`);
  }
};

const loadMemberProjects = async (userId: number, force = false) => {
  if (!force && memberProjects.value[userId]?.length) return;
  projectsLoading.value[userId] = true;
  try {
    const res: any = await getCreativeSquareMemberProjects(userId);
    memberProjects.value[userId] = res.data?.list || [];
  } catch (error) {
    console.error('加载成员项目失败:', error);
    memberProjects.value[userId] = [];
  } finally {
    projectsLoading.value[userId] = false;
  }
};

const syncActiveMember = () => {
  if (!activeMember.value) return;
  const updated = members.value.find((m) => m.user_id === activeMember.value!.user_id);
  if (updated) {
    activeMember.value = updated;
    return;
  }
  showPopup.value = false;
  hoveredUserId.value = null;
  activeMember.value = null;
};

const loadMembers = async () => {
  try {
    const res: any = await getCreativeSquareMembers();
    members.value = res.data?.list || [];
    syncActiveMember();
    if (showPopup.value) {
      await nextTick();
      updatePopupPosition();
    }
  } catch (error) {
    console.error('加载创意广场失败:', error);
  }
};

/** 后台静默刷新，不遮挡 UI */
const refreshAll = async (silent = true) => {
  const openUserId = activeMember.value?.user_id;
  if (openUserId != null) {
    delete memberProjects.value[openUserId];
  }
  if (!silent) loading.value = true;
  try {
    await loadMembers();
    if (showPopup.value && openUserId != null) {
      await loadMemberProjects(openUserId, true);
    }
  } finally {
    if (!silent) loading.value = false;
  }
};

const refreshMembers = async () => {
  if (loading.value) {
    await loadMembers();
    return;
  }
  loading.value = true;
  try {
    await loadMembers();
  } finally {
    loading.value = false;
  }
};

const refreshAllPublic = async () => refreshAll(false);

const scheduleHidePopup = () => {
  if (hidePopupTimer) clearTimeout(hidePopupTimer);
  hidePopupTimer = setTimeout(() => {
    if (!popupHovering.value) {
      showPopup.value = false;
      hoveredUserId.value = null;
      activeMember.value = null;
    }
  }, POPUP_HIDE_DELAY_MS);
};

const handleCardEnter = (member: CreativeSquareMember) => {
  if (hidePopupTimer) {
    clearTimeout(hidePopupTimer);
    hidePopupTimer = null;
  }
  hoveredUserId.value = member.user_id;
  activeMember.value = member;
  showPopup.value = true;
  void loadMemberProjects(member.user_id, true);
  void nextTick(() => updatePopupPosition());
};

const handleCardLeave = () => {
  scheduleHidePopup();
};

const handlePopupEnter = () => {
  popupHovering.value = true;
  if (hidePopupTimer) {
    clearTimeout(hidePopupTimer);
    hidePopupTimer = null;
  }
};

const handlePopupLeave = () => {
  popupHovering.value = false;
  scheduleHidePopup();
};

const onWindowScrollOrResize = () => {
  if (showPopup.value) updatePopupPosition();
};

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    void refreshAll();
  }
};

let offWorkflowListChanged: (() => void) | null = null;

onMounted(() => {
  void refreshMembers();
  pollTimer = setInterval(() => void refreshAll(), POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('scroll', onWindowScrollOrResize, true);
  window.addEventListener('resize', onWindowScrollOrResize);
  offWorkflowListChanged = onWorkflowListChanged(() => {
    void refreshAll();
  });
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (hidePopupTimer) clearTimeout(hidePopupTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('scroll', onWindowScrollOrResize, true);
  window.removeEventListener('resize', onWindowScrollOrResize);
  offWorkflowListChanged?.();
});

defineExpose({
  refresh: refreshAllPublic,
});
</script>

<style scoped>
.creative-square-container {
  width: 100%;
}

.section-header {
  margin-bottom: 24px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-main);
  margin: 0;
}

.member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.member-card {
  position: relative;
  background: var(--app-surface);
  border: 1px solid var(--app-border-color);
  border-radius: 12px;
  overflow: visible;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
}

.member-card:hover,
.member-card--active {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

.member-card--active {
  z-index: 10;
}

.member-preview {
  width: 100%;
  height: 0;
  padding-bottom: 75%;
  position: relative;
  background: var(--app-bg-sub);
  overflow: hidden;
  border-radius: 12px 12px 0 0;
}

.member-preview img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.member-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-subtle);
}

.member-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-canvas-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--text-subtle);
}

@media (max-width: 1024px) {
  .member-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }
}

@media (max-width: 768px) {
  .member-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .member-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<!-- Teleport 到 body，样式不能 scoped -->
<style>
.project-popup {
  position: fixed;
  transform: translate(-50%, -100%);
  width: 580px;
  max-width: min(580px, calc(100vw - 32px));
  padding: 18px 12px;
  background: rgba(20, 20, 24, 0.97);
  border: 1px solid var(--app-border-color, rgba(255, 255, 255, 0.12));
  border-radius: 14px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.52);
  z-index: 3000;
  pointer-events: auto;
}

.project-popup::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 14px;
}

.popup-grid-scroll {
  --popup-item-size: 160px;
  --popup-gap: 14px;
  max-height: calc(var(--popup-item-size) * 3 + var(--popup-gap) * 2);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scroll-padding-bottom: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.45) transparent;
  padding-right: 2px;
}

.popup-grid-scroll::-webkit-scrollbar {
  width: 6px;
}

.popup-grid-scroll::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 999px;
  margin: 10px 0;
}

.popup-grid-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.32) 0%,
    rgba(255, 255, 255, 0.16) 100%
  );
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 56px;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.popup-grid-scroll::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(
    180deg,
    rgba(96, 165, 250, 0.85) 0%,
    rgba(37, 99, 235, 0.65) 100%
  );
  border-color: rgba(147, 197, 253, 0.35);
  box-shadow: 0 0 8px rgba(37, 99, 235, 0.35);
}

.popup-grid-scroll::-webkit-scrollbar-thumb:active {
  background: linear-gradient(
    180deg,
    rgba(59, 130, 246, 0.95) 0%,
    rgba(29, 78, 216, 0.85) 100%
  );
}

.popup-grid-scroll:hover {
  scrollbar-color: rgba(148, 163, 184, 0.55) rgba(255, 255, 255, 0.04);
}

.popup-grid-scroll:hover::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
}

.popup-grid {
  display: grid;
  grid-template-columns: repeat(3, var(--popup-item-size));
  gap: var(--popup-gap);
  justify-content: center;
  padding-bottom: 12px;
}

.popup-item {
  width: var(--popup-item-size);
  height: var(--popup-item-size);
  border-radius: 10px;
  overflow: hidden;
  background: var(--app-bg-sub, #2a2a2e);
  cursor: pointer;
  box-sizing: border-box;
  border: 2px solid transparent;
}

.popup-item:hover {
  border-color: var(--color-primary, #2563eb);
}

.popup-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.popup-item-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-subtle, #888);
  font-size: 36px;
}

.popup-loading,
.popup-empty {
  padding: 36px;
  text-align: center;
  color: var(--text-muted, #aaa);
  font-size: 14px;
}

.popup-fade-enter-active,
.popup-fade-leave-active {
  transition: opacity 0.15s ease;
}

.popup-fade-enter-from,
.popup-fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .project-popup {
    width: min(440px, calc(100vw - 24px));
  }

  .popup-grid-scroll {
    --popup-item-size: 170px;
  }

  .popup-grid {
    grid-template-columns: repeat(2, var(--popup-item-size));
  }
}
</style>
