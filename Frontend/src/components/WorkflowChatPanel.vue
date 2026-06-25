<template>
  <div :class="{ 'chat-popup-root': isPopupMode }">
    <Teleport
      to="body"
      :disabled="isPopupMode"
    >
      <button
        v-if="!isPopupMode && !isOpen"
        type="button"
        class="workflow-chat-toggle"
        aria-label="打开 Gemini 助理"
        @click="togglePanel"
      >
        <img
          :src="chatRobotIconUrl"
          alt="Gemini 助理"
          class="workflow-chat-toggle-icon"
        />
      </button>

      <transition name="workflow-chat-fade">
        <div
          v-if="isOpen || isPopupMode"
          ref="panelRef"
          class="workflow-chat-panel"
          :class="{
            'popup-mode': isPopupMode,
            'is-docked-right': !isPopupMode && dockSide === 'right',
            'is-docked-left': !isPopupMode && dockSide === 'left',
            'is-floating': !isPopupMode && dockSide === 'floating',
            'is-dragging': isDragging,
            'show-snap-hint': showSnapHint,
            'is-width-resizing': isWidthResizing,
            'is-layout-narrow': isPanelLayoutNarrow,
          }"
          :style="panelInlineStyle"
        >
          <div
            v-if="!isPopupMode"
            class="chat-panel-width-resize-handle"
            :class="{ 'is-right-edge': dockSide === 'left' }"
            title="拖动调整面板宽度"
            @mousedown.stop="onWidthResizeStart"
            @touchstart.stop.prevent="onWidthTouchResizeStart"
          />

          <div
            v-if="!isPopupMode"
            class="chat-panel-drag-strip"
            @mousedown="onPanelDragStart"
            @touchstart.prevent="onPanelTouchStart"
          >
            <el-icon class="chat-drag-hint"><Rank /></el-icon>
            <span>拖动移动 · 拖到屏幕边缘松开可吸附</span>
          </div>

          <div class="workflow-chat-layout">
          <aside
            v-if="isSessionsExpanded && sessionsSide === 'left'"
            class="workflow-chat-sessions"
          >
            <div class="sessions-header">
              <span class="sessions-title">会话</span>
              <div class="sessions-actions">
                <el-button
                  size="small"
                  text
                  title="切换到右侧"
                  @click="toggleSessionsSide"
                >
                  <span class="sessions-side-switch-icon">
                    <el-icon><ArrowLeft /></el-icon>
                    <el-icon><ArrowRight /></el-icon>
                  </span>
                </el-button>
                <el-button
                  size="small"
                  type="primary"
                  text
                  @click="createSession"
                >
                  新建
                </el-button>
                <el-button
                  size="small"
                  text
                  title="收起会话"
                  @click="toggleSessionsExpanded"
                >
                  <el-icon><Fold /></el-icon>
                </el-button>
              </div>
            </div>
            <el-scrollbar class="sessions-list">
              <div
                v-for="session in sessions"
                :key="session.id"
                class="session-item"
                :class="{ active: session.id === activeSessionId }"
                @click="setActiveSession(session.id)"
              >
                <div class="session-item-row">
                  <span class="session-title">{{ session.title || '未命名会话' }}</span>
                  <el-button
                    size="small"
                    type="danger"
                    text
                    class="session-delete-btn"
                    @click.stop="deleteSession(session.id)"
                  >
                    删除
                  </el-button>
                </div>
                <div class="session-meta">
                  {{ formatTime(session.createdAt) }}
                </div>
              </div>
            </el-scrollbar>
          </aside>

          <div
            v-if="!isSessionsExpanded && sessionsSide === 'left'"
            class="sessions-collapsed-rail"
          >
            <button
              type="button"
              class="sessions-rail-btn"
              title="展开会话"
              aria-label="展开会话"
              @click="toggleSessionsExpanded"
            >
              <el-icon><ChatLineRound /></el-icon>
            </button>
            <button
              type="button"
              class="sessions-rail-btn"
              title="新建会话"
              aria-label="新建会话"
              @click="createSession"
            >
              <el-icon><Plus /></el-icon>
            </button>
            <div class="sessions-rail-spacer" />
            <button
              type="button"
              class="sessions-rail-btn"
              title="会话栏移到右侧"
              aria-label="会话栏移到右侧"
              @click="toggleSessionsSide"
            >
              <span class="sessions-side-switch-icon">
                <el-icon><ArrowLeft /></el-icon>
                <el-icon><ArrowRight /></el-icon>
              </span>
            </button>
          </div>

          <section
            class="workflow-chat-main"
            :class="{ 'is-narrow': isChatLayoutNarrow }"
          >
            <header
              class="chat-header"
              :class="{ 'chat-header-draggable': !isPopupMode }"
              @mousedown="onPanelDragStart"
              @touchstart.prevent="onPanelTouchStart"
              @dblclick="resetPanelPosition"
            >
              <div class="chat-title">
                <el-icon
                  v-if="!isPopupMode && !isChatLayoutNarrow"
                  class="chat-drag-hint"
                >
                  <Rank />
                </el-icon>
                <span class="chat-title-text">{{ activeSession?.title || 'Gemini 助理' }}</span>
              </div>
              <div
                class="chat-actions"
                @mousedown.stop
                @touchstart.stop
              >
                <el-tooltip
                  v-if="!isPopupMode"
                  content="分离窗口"
                  placement="bottom"
                  :disabled="!isChatLayoutNarrow"
                >
                  <el-button
                    size="small"
                    text
                    @click="detachPanelToPopup"
                  >
                    <el-icon><Monitor /></el-icon>
                    <span class="chat-action-label">分离窗口</span>
                  </el-button>
                </el-tooltip>
                <el-tooltip
                  content="清空"
                  placement="bottom"
                  :disabled="!isChatLayoutNarrow"
                >
                  <el-button
                    size="small"
                    text
                    @click="clearActiveSessionMessages"
                  >
                    <el-icon><Delete /></el-icon>
                    <span class="chat-action-label">清空</span>
                  </el-button>
                </el-tooltip>
                <el-tooltip
                  v-if="!isPopupMode"
                  content="关闭"
                  placement="bottom"
                  :disabled="!isChatLayoutNarrow"
                >
                  <el-button
                    size="small"
                    text
                    @click="closePanel"
                  >
                    <el-icon><Close /></el-icon>
                    <span class="chat-action-label">关闭</span>
                  </el-button>
                </el-tooltip>
              </div>
            </header>

            <div
              v-if="isPopupMode && mainWindowClosed"
              class="chat-popup-warning"
            >
              主窗口已关闭，画布命令将不可用
            </div>

            <el-scrollbar
              ref="messagesScrollRef"
              class="chat-messages"
            >
              <div class="messages-inner">
                <div
                  v-for="msg in activeSession?.messages || []"
                  :key="msg.id"
                  class="message-row"
                  :class="msg.role"
                >
                  <div class="message-bubble">
                    <ChatMessageContent
                      v-if="msg.content"
                      :content="msg.content"
                      class="message-content"
                    />
                    <div
                      v-if="msg.mediaUrls && msg.mediaUrls.length > 0"
                      class="message-media-list"
                    >
                      <div
                        v-for="(mediaUrl, mi) in msg.mediaUrls"
                        :key="`${msg.id}-media-${mi}`"
                        class="message-media-item"
                      >
                        <img
                          v-if="isImageMediaUrl(mediaUrl)"
                          :src="resolveMediaUrl(mediaUrl)"
                          :alt="`媒体 ${mi + 1}`"
                          class="message-media-thumb"
                          @click="previewMessageMedia(mediaUrl)"
                        />
                        <div
                          v-else
                          class="message-media-video-thumb"
                          @click="previewMessageMedia(mediaUrl)"
                        >
                          <video
                            :src="resolveMediaUrl(mediaUrl)"
                            class="message-media-video-preview"
                            muted
                            preload="metadata"
                            @click.stop="previewMessageMedia(mediaUrl)"
                          />
                          <div class="message-media-video-badge">
                            <el-icon><VideoCamera /></el-icon>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="message-time">
                      {{ formatTime(msg.createdAt) }}
                    </div>
                  </div>
                </div>

                <div
                  v-if="loading"
                  class="message-row assistant"
                >
                  <div class="message-bubble loading">
                    正在思考中…
                  </div>
                </div>

                <div
                  v-if="errorMessage"
                  class="chat-error"
                >
                  {{ errorMessage }}
                </div>
              </div>
            </el-scrollbar>

            <footer class="chat-input-area">
              <!-- 已上传媒体列表 -->
              <div v-if="uploadedMedia.length > 0" class="uploaded-media-list">
                <div
                  v-for="(media, index) in uploadedMedia"
                  :key="index"
                  class="media-item"
                  @click="previewMedia(media)"
                >
                  <img
                    v-if="media.type === 'image'"
                    :src="media.previewUrl"
                    :alt="`上传的图片 ${index + 1}`"
                    class="media-thumbnail"
                  />
                  <div
                    v-else
                    class="media-thumbnail video-placeholder"
                    @click.stop="previewMedia(media)"
                  >
                    <video
                      :src="media.previewUrl"
                      class="media-video-preview"
                      muted
                      preload="metadata"
                    />
                    <div class="video-overlay">
                      <el-icon class="video-icon"><VideoCamera /></el-icon>
                    </div>
                  </div>
                  <el-button
                    size="small"
                    type="danger"
                    text
                    class="media-remove-btn"
                    @click.stop="removeMedia(index)"
                  >
                    <el-icon><Close /></el-icon>
                  </el-button>
                </div>
              </div>

              <div
                class="chat-input-wrapper"
                :class="{ 'is-input-resizing': isInputResizing }"
                :style="{ height: `${inputAreaHeight}px` }"
                @drop.prevent="handleDrop"
                @dragover.prevent
              >
                <div
                  class="chat-input-resize-handle"
                  title="拖动调整输入框高度"
                  @mousedown.stop="onInputResizeStart"
                  @touchstart.stop.prevent="onInputTouchResizeStart"
                />
                <el-input
                  v-model="currentInput"
                  type="textarea"
                  :maxlength="50000"
                  class="chat-input"
                  placeholder="输入您的问题，我来帮您解答...

支持拖拽图片或视频到此处上传"
                  @keydown.enter.exact.prevent="handleSend"
                  @keydown.enter.shift.prevent="insertNewLine"
                  show-word-limit
                />
                <input
                  ref="fileInputRef"
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  class="file-input-hidden"
                  @change="handleFileSelect"
                />
              </div>

              <div class="chat-input-actions">
                <div class="chat-input-left">
                  <el-button
                    size="small"
                    icon
                    @click="triggerFileInput"
                  >
                    <el-icon><Plus /></el-icon>
                  </el-button>
                  <span class="chat-input-tip">Enter 发送 · 拖输入框上边框调高度 · 拖左侧边缘调宽度</span>
                </div>
                <el-button
                  type="primary"
                  :loading="loading"
                  :disabled="(!currentInput && uploadedMedia.length === 0) || loading"
                  @click="() => void handleSend()"
                >
                  发送
                </el-button>
              </div>
            </footer>
          </section>

          <aside
            v-if="isSessionsExpanded && sessionsSide === 'right'"
            class="workflow-chat-sessions is-right-side"
          >
            <div class="sessions-header">
              <span class="sessions-title">会话</span>
              <div class="sessions-actions">
                <el-button
                  size="small"
                  text
                  title="切换到左侧"
                  @click="toggleSessionsSide"
                >
                  <span class="sessions-side-switch-icon">
                    <el-icon><ArrowLeft /></el-icon>
                    <el-icon><ArrowRight /></el-icon>
                  </span>
                </el-button>
                <el-button
                  size="small"
                  type="primary"
                  text
                  @click="createSession"
                >
                  新建
                </el-button>
                <el-button
                  size="small"
                  text
                  title="收起会话"
                  @click="toggleSessionsExpanded"
                >
                  <el-icon><Fold /></el-icon>
                </el-button>
              </div>
            </div>
            <el-scrollbar class="sessions-list">
              <div
                v-for="session in sessions"
                :key="session.id"
                class="session-item"
                :class="{ active: session.id === activeSessionId }"
                @click="setActiveSession(session.id)"
              >
                <div class="session-item-row">
                  <span class="session-title">{{ session.title || '未命名会话' }}</span>
                  <el-button
                    size="small"
                    type="danger"
                    text
                    class="session-delete-btn"
                    @click.stop="deleteSession(session.id)"
                  >
                    删除
                  </el-button>
                </div>
                <div class="session-meta">
                  {{ formatTime(session.createdAt) }}
                </div>
              </div>
            </el-scrollbar>
          </aside>

          <div
            v-if="!isSessionsExpanded && sessionsSide === 'right'"
            class="sessions-collapsed-rail is-right-side"
          >
            <button
              type="button"
              class="sessions-rail-btn"
              title="展开会话"
              aria-label="展开会话"
              @click="toggleSessionsExpanded"
            >
              <el-icon><ChatLineRound /></el-icon>
            </button>
            <button
              type="button"
              class="sessions-rail-btn"
              title="新建会话"
              aria-label="新建会话"
              @click="createSession"
            >
              <el-icon><Plus /></el-icon>
            </button>
            <div class="sessions-rail-spacer" />
            <button
              type="button"
              class="sessions-rail-btn"
              title="会话栏移到左侧"
              aria-label="会话栏移到左侧"
              @click="toggleSessionsSide"
            >
              <span class="sessions-side-switch-icon">
                <el-icon><ArrowLeft /></el-icon>
                <el-icon><ArrowRight /></el-icon>
              </span>
            </button>
          </div>
          </div>

          <div
            v-if="!isPopupMode"
            class="chat-panel-corner-grip"
            title="拖动移动窗口"
            @mousedown="onPanelDragStart"
            @touchstart.prevent="onPanelTouchStart"
          >
            <el-icon><Rank /></el-icon>
          </div>

          <div
            v-if="showSnapHint && !isPopupMode"
            class="chat-snap-hint"
          >
            松开鼠标即可吸附到边缘
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 图片预览弹窗 -->
    <Teleport to="body">
      <el-image-viewer
        v-if="showPreview && previewMediaUrl"
        :url-list="[previewMediaUrl]"
        :initial-index="0"
        @close="closePreview"
      />
      <div
        v-if="showVideoPreview && previewVideoUrl"
        class="chat-video-preview-mask"
        @click.self="closeVideoPreview"
      >
        <div class="chat-video-preview-panel">
          <button
            type="button"
            class="chat-video-preview-close"
            @click="closeVideoPreview"
          >
            关闭
          </button>
          <video
            :src="previewVideoUrl"
            class="chat-video-preview-player"
            controls
            autoplay
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { ElMessage, ElImageViewer } from 'element-plus';
import { Plus, Close, VideoCamera, Rank, ChatLineRound, Fold, ArrowLeft, ArrowRight, Monitor, Delete } from '@element-plus/icons-vue';
import { useUserStore } from '@/store/user';
import type { ChatHistoryItem, GeminiChatRequest } from '@/api/chat';
import {
  sendGeminiChat,
  sendGeminiChatStream,
  uploadChatMedia,
  deleteChatMedia,
  getChatSessions,
  saveChatSession,
  bulkSaveChatSessions,
  deleteChatSessionApi,
} from '@/api/chat';
import ChatMessageContent from '@/components/ChatMessageContent.vue';
import { getUploadUrl } from '@/utils/image-loader';
import {
  useChatWindowBridge,
  openChatPopup,
  postChatBridgeMessage,
  subscribeChatBridge,
  type ChatBridgeMessage,
} from '@/composables/useChatWindowBridge';

const chatRobotIconUrl = `${import.meta.env.BASE_URL}icon_robot.png`;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mediaUrls?: string[];
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const props = withDefaults(
  defineProps<{
    workflowContext?: unknown;
    mode?: 'embedded' | 'popup';
  }>(),
  { mode: 'embedded' },
);

const isPopupMode = computed(() => props.mode === 'popup');
const popupBridge = isPopupMode.value ? useChatWindowBridge('popup') : null;
const mainWindowClosed = computed(() =>
  isPopupMode.value ? popupBridge!.mainWindowClosed.value : false,
);
let unsubscribeBridge: (() => void) | null = null;

const emit = defineEmits<{
  /**
   * 由 Gemini 输出的“画布执行命令”（例如：创建 prompt+dream 并连线）。
   * 前端解析 JSON 后把命令透传给 Workflow 侧执行器。
   */
  (e: 'gemini-command', cmd: any): void;
}>();

const userStore = useUserStore();

const isOpen = ref(props.mode === 'popup');
const sessions = ref<ChatSession[]>([]);
const activeSessionId = ref<string>('');
const applyingRemoteSessions = ref(false);
const loadingSessions = ref(false);
let refreshSignalTimer: ReturnType<typeof setTimeout> | null = null;
let scrollRafId: number | null = null;
let scrollPending = false;
const currentInput = ref('');
const loading = ref(false);
const errorMessage = ref('');

const messagesScrollRef = ref();
const fileInputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

interface PanelPosition {
  x: number;
  y: number;
}

type DockSide = 'right' | 'left' | 'floating';

const PANEL_WIDTH_MIN = 320;
const PANEL_WIDTH_DEFAULT = 560;
const PANEL_WIDTH_MAX_CAP = 1600;
const SNAP_EDGE_PX = 36;

const panelPos = ref<PanelPosition | null>(null);
const dockSide = ref<DockSide>('right');
const panelWidth = ref(PANEL_WIDTH_DEFAULT);
const isSessionsExpanded = ref(false);
type SessionsSide = 'left' | 'right';
const sessionsSide = ref<SessionsSide>('left');
const isDragging = ref(false);
const showSnapHint = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

const isWidthResizing = ref(false);
const widthResizeStart = ref({ x: 0, width: PANEL_WIDTH_DEFAULT });

const INPUT_HEIGHT_MIN = 96;
const INPUT_HEIGHT_MAX = 520;
const INPUT_HEIGHT_DEFAULT = 220;
const inputAreaHeight = ref(INPUT_HEIGHT_DEFAULT);
const isInputResizing = ref(false);
const inputResizeStart = ref({ y: 0, height: INPUT_HEIGHT_DEFAULT });

const inputHeightKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_input_height_${id}`;
});

const panelPositionKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_panel_pos_${id}`;
});

const panelWidthKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_panel_width_${id}`;
});

const dockSideKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_dock_${id}`;
});

const sessionsExpandedKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_sessions_expanded_${id}`;
});

const sessionsSideKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_sessions_side_${id}`;
});

const getPanelWidthMax = () => Math.min(PANEL_WIDTH_MAX_CAP, window.innerWidth * 0.96);

const clampPanelWidth = (width: number) =>
  Math.max(PANEL_WIDTH_MIN, Math.min(width, getPanelWidthMax()));

const SESSIONS_PANEL_WIDTH = 220;
const SESSIONS_RAIL_WIDTH = 44;
const CHAT_LAYOUT_NARROW_THRESHOLD = 480;
const PANEL_LAYOUT_NARROW_THRESHOLD = 420;

const chatMainEstimatedWidth = computed(() => {
  if (isPopupMode.value) return panelWidth.value;
  const sessionsPart = isSessionsExpanded.value ? SESSIONS_PANEL_WIDTH : SESSIONS_RAIL_WIDTH;
  return panelWidth.value - sessionsPart;
});

const isChatLayoutNarrow = computed(() =>
  !isPopupMode.value && chatMainEstimatedWidth.value < CHAT_LAYOUT_NARROW_THRESHOLD,
);

const isPanelLayoutNarrow = computed(() =>
  !isPopupMode.value && panelWidth.value < PANEL_LAYOUT_NARROW_THRESHOLD,
);

const panelInlineStyle = computed(() => {
  if (isPopupMode.value) return undefined;
  const style: Record<string, string> = {
    '--chat-panel-width': `${panelWidth.value}px`,
  };
  if (dockSide.value === 'floating' && panelPos.value) {
    style.left = `${panelPos.value.x}px`;
    style.top = `${panelPos.value.y}px`;
    style.transform = 'none';
    style.bottom = 'auto';
    style.right = 'auto';
  }
  return style;
});

interface UploadedMedia {
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
  fileName: string;
}

const uploadedMedia = ref<UploadedMedia[]>([]);
const previewMediaUrl = ref('');
const showPreview = ref(false);
const previewVideoUrl = ref('');
const showVideoPreview = ref(false);

const activeSession = computed(() =>
  sessions.value.find((s) => s.id === activeSessionId.value),
);

const legacyStorageKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_sessions_${id}`;
});

const activeSessionKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_active_session_${id}`;
});

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return iso;
  }
};

const persistActiveSessionId = () => {
  try {
    window.localStorage.setItem(activeSessionKey.value, activeSessionId.value);
  } catch {
    // ignore
  }
};

const loadActiveSessionId = () => {
  try {
    return window.localStorage.getItem(activeSessionKey.value) || '';
  } catch {
    return '';
  }
};

const notifySessionsRefresh = () => {
  if (applyingRemoteSessions.value) return;
  if (refreshSignalTimer) clearTimeout(refreshSignalTimer);
  refreshSignalTimer = setTimeout(() => {
    refreshSignalTimer = null;
    postChatBridgeMessage({ type: 'sessions-refresh' });
  }, 300);
};

const saveSessionToServer = async (session: ChatSession) => {
  try {
    await saveChatSession(normalizeSession(session));
    notifySessionsRefresh();
  } catch {
    // ignore save errors
  }
};

const saveActiveSessionToServer = async () => {
  const session = activeSession.value;
  if (!session) return;
  await saveSessionToServer(session);
};

watch(activeSessionId, () => {
  persistActiveSessionId();
});

const scrollToBottom = async (force = false) => {
  if (!force && scrollPending) return;
  scrollPending = !force;
  if (scrollRafId) cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(async () => {
    scrollRafId = null;
    await nextTick();
    const scrollComp = messagesScrollRef.value as any;
    if (scrollComp?.wrapRef) {
      const el = scrollComp.wrapRef as HTMLElement;
      el.scrollTop = el.scrollHeight;
    }
    scrollPending = false;
  });
};

const normalizeSession = (session: ChatSession): ChatSession => ({
  ...session,
  updatedAt: session.updatedAt || session.createdAt,
  messages: (session.messages || []).map((m) => ({
    ...m,
    mediaUrls: m.mediaUrls || [],
  })),
});

const collectSessionMediaUrls = (session: ChatSession): string[] => {
  const urls: string[] = [];
  for (const msg of session.messages || []) {
    if (msg.mediaUrls?.length) {
      urls.push(...msg.mediaUrls);
    }
  }
  return [...new Set(urls)];
};

const deleteMediaUrls = async (urls: string[]) => {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    await deleteChatMedia(unique);
  } catch {
    // ignore cleanup errors
  }
};

const ensureDefaultSession = () => {
  if (sessions.value.length === 0) {
    const now = new Date().toISOString();
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessions.value.push({
      id,
      title: '新的会话',
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
    activeSessionId.value = id;
    persistActiveSessionId();
    return;
  }

  const activeExists = sessions.value.some((s) => s.id === activeSessionId.value);
  if (!activeSessionId.value || !activeExists) {
    activeSessionId.value = sessions.value[0]?.id ?? '';
    persistActiveSessionId();
  }
};

const applySessionsFromData = (parsed: ChatSession[], nextActiveId?: string) => {
  applyingRemoteSessions.value = true;
  try {
    if (Array.isArray(parsed)) {
      sessions.value = parsed.map(normalizeSession);
    }
    if (
      nextActiveId
      && sessions.value.some((s) => s.id === nextActiveId)
    ) {
      activeSessionId.value = nextActiveId;
    }
    ensureDefaultSession();
  } finally {
    applyingRemoteSessions.value = false;
  }
};

const readLegacySessions = (): ChatSession[] => {
  try {
    const raw = window.localStorage.getItem(legacyStorageKey.value);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSession)
      .filter((session) => typeof session.id === 'string' && session.id);
  } catch {
    return [];
  }
};

const clearLegacySessions = () => {
  try {
    window.localStorage.removeItem(legacyStorageKey.value);
  } catch {
    // ignore
  }
};

/** 读取本地会话 → 上传服务端 → 成功后删除本地记录 */
const migrateLegacySessionsToServer = async (): Promise<number> => {
  const localSessions = readLegacySessions();
  if (localSessions.length === 0) {
    clearLegacySessions();
    return 0;
  }
  try {
    await bulkSaveChatSessions(localSessions);
    clearLegacySessions();
    return localSessions.length;
  } catch {
    // 上传失败时保留本地，下次进入再试
    return 0;
  }
};

const loadSessionsFromServer = async () => {
  if (!userStore.token) {
    ensureDefaultSession();
    return;
  }
  if (loadingSessions.value) return;
  loadingSessions.value = true;
  try {
    await migrateLegacySessionsToServer();
    const res: any = await getChatSessions();
    const remoteSessions = res?.data?.sessions ?? [];
    applySessionsFromData(remoteSessions, loadActiveSessionId() || undefined);
    if (isOpen.value || isPopupMode.value) {
      await scrollToBottom(true);
    }
  } catch {
    ensureDefaultSession();
  } finally {
    loadingSessions.value = false;
  }
};

const loadPanelPosition = () => {
  if (isPopupMode.value) return;
  try {
    const raw = window.localStorage.getItem(panelPositionKey.value);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PanelPosition;
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      panelPos.value = parsed;
    }
  } catch {
    // ignore
  }
};

const loadDockSettings = () => {
  if (isPopupMode.value) return;

  try {
    const widthRaw = window.localStorage.getItem(panelWidthKey.value);
    if (widthRaw) {
      const parsed = Number(widthRaw);
      if (Number.isFinite(parsed)) {
        panelWidth.value = clampPanelWidth(parsed);
      }
    }
  } catch {
    // ignore
  }

  try {
    const dockRaw = window.localStorage.getItem(dockSideKey.value);
    if (dockRaw === 'right' || dockRaw === 'left' || dockRaw === 'floating') {
      dockSide.value = dockRaw;
    } else {
      const posRaw = window.localStorage.getItem(panelPositionKey.value);
      dockSide.value = posRaw ? 'floating' : 'right';
    }
  } catch {
    dockSide.value = 'right';
  }

  if (dockSide.value === 'floating') {
    loadPanelPosition();
    if (!panelPos.value) {
      dockSide.value = 'right';
    }
  } else {
    panelPos.value = null;
  }

  try {
    const sideRaw = window.localStorage.getItem(sessionsSideKey.value);
    if (sideRaw === 'left' || sideRaw === 'right') {
      sessionsSide.value = sideRaw;
    }
  } catch {
    // ignore
  }
};

const persistPanelWidth = () => {
  try {
    window.localStorage.setItem(panelWidthKey.value, String(panelWidth.value));
  } catch {
    // ignore
  }
};

const persistDockSide = () => {
  try {
    window.localStorage.setItem(dockSideKey.value, dockSide.value);
  } catch {
    // ignore
  }
};

const toggleSessionsExpanded = () => {
  isSessionsExpanded.value = !isSessionsExpanded.value;
  try {
    window.localStorage.setItem(
      sessionsExpandedKey.value,
      String(isSessionsExpanded.value),
    );
  } catch {
    // ignore
  }
};

const persistSessionsSide = () => {
  try {
    window.localStorage.setItem(sessionsSideKey.value, sessionsSide.value);
  } catch {
    // ignore
  }
};

const toggleSessionsSide = () => {
  sessionsSide.value = sessionsSide.value === 'left' ? 'right' : 'left';
  persistSessionsSide();
};

const clampInputHeight = (height: number) =>
  Math.max(INPUT_HEIGHT_MIN, Math.min(height, INPUT_HEIGHT_MAX));

const loadInputHeight = () => {
  try {
    const raw = window.localStorage.getItem(inputHeightKey.value);
    if (!raw) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      inputAreaHeight.value = clampInputHeight(parsed);
    }
  } catch {
    // ignore
  }
};

const persistInputHeight = () => {
  try {
    window.localStorage.setItem(inputHeightKey.value, String(inputAreaHeight.value));
  } catch {
    // ignore
  }
};

const onInputResizeMove = (clientY: number) => {
  if (!isInputResizing.value) return;
  const delta = inputResizeStart.value.y - clientY;
  inputAreaHeight.value = clampInputHeight(inputResizeStart.value.height + delta);
};

const endInputResize = () => {
  if (!isInputResizing.value) return;
  isInputResizing.value = false;
  document.removeEventListener('mousemove', onInputResizeMouseMove);
  document.removeEventListener('mouseup', endInputResize);
  document.removeEventListener('touchmove', onInputResizeTouchMove);
  document.removeEventListener('touchend', endInputResize);
  persistInputHeight();
};

const onInputResizeMouseMove = (e: MouseEvent) => {
  onInputResizeMove(e.clientY);
};

const onInputResizeTouchMove = (e: TouchEvent) => {
  const touch = e.touches[0];
  if (!touch) return;
  e.preventDefault();
  onInputResizeMove(touch.clientY);
};

const onInputResizeStart = (e: MouseEvent) => {
  if (e.button !== 0) return;
  isInputResizing.value = true;
  inputResizeStart.value = { y: e.clientY, height: inputAreaHeight.value };
  document.addEventListener('mousemove', onInputResizeMouseMove);
  document.addEventListener('mouseup', endInputResize);
};

const onInputTouchResizeStart = (e: TouchEvent) => {
  const touch = e.touches[0];
  if (!touch) return;
  isInputResizing.value = true;
  inputResizeStart.value = { y: touch.clientY, height: inputAreaHeight.value };
  document.addEventListener('touchmove', onInputResizeTouchMove, { passive: false });
  document.addEventListener('touchend', endInputResize);
};

const persistPanelPosition = () => {
  if (isPopupMode.value) return;
  try {
    if (dockSide.value === 'floating' && panelPos.value) {
      window.localStorage.setItem(panelPositionKey.value, JSON.stringify(panelPos.value));
    } else {
      window.localStorage.removeItem(panelPositionKey.value);
    }
  } catch {
    // ignore
  }
};

const onWidthResizeMove = (clientX: number) => {
  if (!isWidthResizing.value) return;
  const delta = clientX - widthResizeStart.value.x;
  if (dockSide.value === 'left') {
    panelWidth.value = clampPanelWidth(widthResizeStart.value.width + delta);
  } else {
    panelWidth.value = clampPanelWidth(widthResizeStart.value.width - delta);
  }
};

const endWidthResize = () => {
  if (!isWidthResizing.value) return;
  isWidthResizing.value = false;
  document.removeEventListener('mousemove', onWidthResizeMouseMove);
  document.removeEventListener('mouseup', endWidthResize);
  document.removeEventListener('touchmove', onWidthResizeTouchMove);
  document.removeEventListener('touchend', endWidthResize);
  persistPanelWidth();
};

const onWidthResizeMouseMove = (e: MouseEvent) => {
  onWidthResizeMove(e.clientX);
};

const onWidthResizeTouchMove = (e: TouchEvent) => {
  const touch = e.touches[0];
  if (!touch) return;
  e.preventDefault();
  onWidthResizeMove(touch.clientX);
};

const onWidthResizeStart = (e: MouseEvent) => {
  if (isPopupMode.value || e.button !== 0) return;
  isWidthResizing.value = true;
  widthResizeStart.value = { x: e.clientX, width: panelWidth.value };
  document.addEventListener('mousemove', onWidthResizeMouseMove);
  document.addEventListener('mouseup', endWidthResize);
};

const onWidthTouchResizeStart = (e: TouchEvent) => {
  const touch = e.touches[0];
  if (!touch || isPopupMode.value) return;
  isWidthResizing.value = true;
  widthResizeStart.value = { x: touch.clientX, width: panelWidth.value };
  document.addEventListener('touchmove', onWidthResizeTouchMove, { passive: false });
  document.addEventListener('touchend', endWidthResize);
};

const clampPanelPosition = (x: number, y: number) => {
  const panel = panelRef.value;
  if (!panel) return { x, y };
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  return {
    x: Math.max(-w + 80, Math.min(x, window.innerWidth - 80)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
  };
};

const isNearViewportEdge = (rect: DOMRect) => {
  const distances = [
    rect.left,
    window.innerWidth - rect.right,
    rect.top,
    window.innerHeight - rect.bottom,
  ];
  return Math.min(...distances) < SNAP_EDGE_PX;
};

const updateSnapHint = () => {
  const panel = panelRef.value;
  if (!panel || isPopupMode.value) {
    showSnapHint.value = false;
    return;
  }
  showSnapHint.value = isNearViewportEdge(panel.getBoundingClientRect());
};

const ensurePanelPositionFromDom = () => {
  const panel = panelRef.value;
  if (!panel) return;
  if (dockSide.value !== 'floating') {
    const rect = panel.getBoundingClientRect();
    panelPos.value = { x: rect.left, y: rect.top };
    dockSide.value = 'floating';
    persistDockSide();
  } else if (!panelPos.value) {
    const rect = panel.getBoundingClientRect();
    panelPos.value = { x: rect.left, y: rect.top };
  }
};

const snapPanelToEdge = (rect: DOMRect) => {
  const distances: Record<string, number> = {
    left: rect.left,
    right: window.innerWidth - rect.right,
    top: rect.top,
    bottom: window.innerHeight - rect.bottom,
  };

  const minDist = Math.min(...Object.values(distances));
  if (minDist >= SNAP_EDGE_PX) {
    dockSide.value = 'floating';
    persistDockSide();
    persistPanelPosition();
    return;
  }

  const edge = Object.entries(distances).find(([, d]) => d === minDist)?.[0];

  if (edge === 'right') {
    dockSide.value = 'right';
    panelPos.value = null;
  } else if (edge === 'left') {
    dockSide.value = 'left';
    panelPos.value = null;
  } else if (edge === 'top' && panelPos.value) {
    dockSide.value = 'floating';
    panelPos.value = clampPanelPosition(panelPos.value.x, 0);
  } else if (edge === 'bottom' && panelPos.value) {
    dockSide.value = 'floating';
    const panel = panelRef.value;
    const h = panel?.offsetHeight ?? rect.height;
    panelPos.value = clampPanelPosition(panelPos.value.x, window.innerHeight - h);
  } else {
    dockSide.value = 'floating';
  }

  persistDockSide();
  persistPanelPosition();
};

const onPanelDragMove = (e: MouseEvent) => {
  if (!isDragging.value || !panelPos.value) return;
  const next = clampPanelPosition(
    e.clientX - dragOffset.value.x,
    e.clientY - dragOffset.value.y,
  );
  panelPos.value = next;
  updateSnapHint();
};

const detachPanelToPopup = async () => {
  await saveActiveSessionToServer();
  const popup = openChatPopup();
  if (!popup) {
    ElMessage.warning('无法打开独立窗口，请在浏览器地址栏允许本站弹窗后重试');
    return false;
  }
  notifySessionsRefresh();
  closePanel();
  dockSide.value = 'right';
  panelPos.value = null;
  persistDockSide();
  persistPanelPosition();
  showSnapHint.value = false;
  ElMessage.success('已分离到独立窗口，可拖到另一块屏幕');
  return true;
};

const onPanelDragEnd = () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.removeEventListener('mousemove', onPanelDragMove);
  document.removeEventListener('mouseup', onPanelDragEnd);

  const panel = panelRef.value;
  if (panel) {
    snapPanelToEdge(panel.getBoundingClientRect());
  }
  showSnapHint.value = false;
};

const onPanelDragStart = (e: MouseEvent) => {
  if (isPopupMode.value || e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('.chat-actions, .el-button, button, a, input, textarea')) return;

  ensurePanelPositionFromDom();
  if (!panelPos.value) return;

  isDragging.value = true;
  dragOffset.value = {
    x: e.clientX - panelPos.value.x,
    y: e.clientY - panelPos.value.y,
  };

  document.addEventListener('mousemove', onPanelDragMove);
  document.addEventListener('mouseup', onPanelDragEnd);
};

const onPanelTouchMove = (e: TouchEvent) => {
  if (!isDragging.value || !panelPos.value) return;
  const touch = e.touches[0];
  if (!touch) return;
  const next = clampPanelPosition(
    touch.clientX - dragOffset.value.x,
    touch.clientY - dragOffset.value.y,
  );
  panelPos.value = next;
  updateSnapHint();
};

const onPanelTouchEnd = () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.removeEventListener('touchmove', onPanelTouchMove);
  document.removeEventListener('touchend', onPanelTouchEnd);

  const panel = panelRef.value;
  if (panel) {
    snapPanelToEdge(panel.getBoundingClientRect());
  }
  showSnapHint.value = false;
};

const onPanelTouchStart = (e: TouchEvent) => {
  if (isPopupMode.value || e.touches.length === 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('.chat-actions, .el-button, button, a, input, textarea')) return;

  ensurePanelPositionFromDom();
  if (!panelPos.value) return;

  const touch = e.touches[0];
  if (!touch) return;
  isDragging.value = true;
  dragOffset.value = {
    x: touch.clientX - panelPos.value.x,
    y: touch.clientY - panelPos.value.y,
  };

  document.addEventListener('touchmove', onPanelTouchMove, { passive: false });
  document.addEventListener('touchend', onPanelTouchEnd);
};

const resetPanelPosition = (e: MouseEvent) => {
  if (isPopupMode.value) return;
  const target = e.target as HTMLElement;
  if (target.closest('.chat-actions, .el-button, button')) return;
  dockSide.value = 'right';
  panelPos.value = null;
  persistDockSide();
  persistPanelPosition();
};

const togglePanel = async () => {
  if (!isOpen.value) {
    await loadSessionsFromServer();
  }
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await scrollToBottom(true);
  }
};

const closePanel = () => {
  isOpen.value = false;
};

const createSession = async () => {
  const now = new Date().toISOString();
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: ChatSession = {
    id,
    title: '新的会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  sessions.value.unshift(session);
  activeSessionId.value = id;
  persistActiveSessionId();
  await saveSessionToServer(session);
};


const setActiveSession = (id: string) => {
  activeSessionId.value = id;
  persistActiveSessionId();
  scrollToBottom();
};

const clearActiveSessionMessages = async () => {
  if (!activeSession.value) return;
  const urls = collectSessionMediaUrls(activeSession.value);
  await deleteMediaUrls(urls);
  activeSession.value.messages = [];
  activeSession.value.updatedAt = new Date().toISOString();
  await saveActiveSessionToServer();
};

/** 删除指定会话；若删的是当前会话则切换到其他会话 */
const deleteSession = async (sessionId: string) => {
  const target = sessions.value.find((s) => s.id === sessionId);
  if (target) {
    await deleteMediaUrls(collectSessionMediaUrls(target));
  }

  if (sessions.value.length <= 1) {
    try {
      await deleteChatSessionApi(sessionId);
      notifySessionsRefresh();
    } catch {
      // ignore
    }
    sessions.value = [];
    ensureDefaultSession();
    const created = activeSession.value;
    if (created) {
      await saveSessionToServer(created);
    }
    return;
  }
  const idx = sessions.value.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  sessions.value.splice(idx, 1);
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = sessions.value[0]?.id ?? sessions.value[sessions.value.length - 1]?.id ?? '';
    persistActiveSessionId();
  }
  try {
    await deleteChatSessionApi(sessionId);
    notifySessionsRefresh();
  } catch {
    // ignore
  }
};

const buildHistoryForRequest = (session: ChatSession, excludeLast = false): ChatHistoryItem[] => {
  const MAX_HISTORY = 10;
  let messages = session.messages;
  if (excludeLast && messages.length > 0) {
    messages = messages.slice(0, -1);
  }
  const recent = messages.slice(-MAX_HISTORY);
  return recent.map((m) => ({
    role: m.role,
    content: m.content,
  }));
};

const buildWorkflowContext = () => {
  const base: any = { time: new Date().toISOString() };
  const ctx =
    props.mode === 'popup'
      ? popupBridge?.workflowContext.value
      : props.workflowContext;
  if (ctx && typeof ctx === 'object') {
    return { ...base, ...ctx };
  }
  return base;
};

const isImageMediaUrl = (url: string) => {
  const lower = url.toLowerCase();
  return !lower.includes('.mp4') && !lower.includes('.mov') && !lower.includes('.webm') && !lower.includes('.mkv');
};

const resolveMediaUrl = (url: string) => getUploadUrl(url);

const previewMessageMedia = (url: string) => {
  const resolved = resolveMediaUrl(url);
  if (isImageMediaUrl(url)) {
    previewMediaUrl.value = resolved;
    showPreview.value = true;
    return;
  }
  previewVideoUrl.value = resolved;
  showVideoPreview.value = true;
};

const emitGeminiCommand = (cmd: unknown) => {
  if (props.mode === 'popup' && popupBridge) {
    popupBridge.sendGeminiCommand(cmd);
  } else {
    emit('gemini-command', cmd);
  }
};

const handleSend = async () => {
  const content = currentInput.value;
  if (!content && uploadedMedia.value.length === 0) return;
  if (loading.value) return;

  ensureDefaultSession();
  if (!activeSession.value) {
    await createSession();
  }
  const session = activeSession.value;
  if (!session) return;

  const now = new Date().toISOString();

  const userMsg: ChatMessage = {
    id: `m_${Date.now()}_u`,
    role: 'user',
    content: content || '',
    createdAt: now,
    mediaUrls: [],
  };

  currentInput.value = '';
  const pendingMedia = [...uploadedMedia.value];
  uploadedMedia.value = [];
  revokeMediaPreviewUrls(pendingMedia);
  errorMessage.value = '';

  loading.value = true;
  const uploadedTempUrls: string[] = [];
  try {
    session.messages.push(userMsg);
    session.updatedAt = now;

    const titleSeed = content.trim() || '图片/视频分析';
    if (!session.title || session.title === '新的会话') {
      session.title = titleSeed.slice(0, 20);
    }

    await scrollToBottom();
    for (const media of pendingMedia) {
      const res: any = await uploadChatMedia(media.file, session.id);
      const url = res?.data?.url;
      if (!url) {
        throw new Error(`文件 ${media.fileName} 上传失败`);
      }
      uploadedTempUrls.push(url);
    }
    userMsg.mediaUrls = [...uploadedTempUrls];

    const mediaUrls = [...uploadedTempUrls];
    const payload: GeminiChatRequest = {
      message: content || '分析上传的媒体内容',
      history: buildHistoryForRequest(session, true),
      workflowContext: buildWorkflowContext(),
      mediaUrls,
      temperature: 0.7,
    };
    // 创建一条空的 assistant 消息，用于流式追加
    const nowReply = new Date().toISOString();
    const assistantMsg: ChatMessage = {
      id: `m_${Date.now()}_a`,
      role: 'assistant',
      content: '',
      createdAt: nowReply,
    };
    session.messages.push(assistantMsg);
    await scrollToBottom();

    // 优先尝试真正的流式接口：每次拿到增量就直接拼接
    try {
      await sendGeminiChatStream(payload, async (delta) => {
        assistantMsg.content += delta;
        await scrollToBottom();
      });
    } catch (streamError) {
      // 如果流式失败，回退到一次性接口，至少保证可用
      const res = await sendGeminiChat(payload);
      const raw: any = res.data ?? res;
      const reply =
        raw?.data?.reply ??
        raw?.reply ??
        raw?.choices?.[0]?.message?.content ??
        raw?.choices?.[0]?.text ??
        '';
      if (!reply) {
        const backendMsg = raw?.message || '未获得模型回复';
        throw new Error(backendMsg);
      }
      assistantMsg.content = reply;
      await scrollToBottom();
    }

    // 一轮回复结束后，立即强制持久化，避免刷新丢失最后一条内容
    // 先尝试从 assistantMsg.content 中提取 JSON 命令并通知 Workflow 执行
    // 解析失败不执行画布操作，只展示自然语言
    const tryExtractCmd = (raw: string) => {
      if (!raw) return null;
      const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
      if (!fenceMatch?.[1]) return null;
      const jsonText = fenceMatch[1].trim();
      if (!jsonText) return null;
      try {
        const parsed = JSON.parse(jsonText) as any;
        const intent = parsed?.intent;
        const promptText = parsed?.promptText ?? parsed?.prompt_text;
        if (intent !== 'create_image_pipeline' && intent !== 'create_video_pipeline') return null;
        if (typeof promptText !== 'string' || !promptText.trim()) return null;
        return { ...parsed, promptText };
      } catch {
        return null;
      }
    };

    const cmd = tryExtractCmd(assistantMsg.content);
    if (cmd) {
      try {
        emitGeminiCommand(cmd);
      } catch {
        // ignore emit failure
      }
    }
    session.updatedAt = new Date().toISOString();
    await saveActiveSessionToServer();
    await scrollToBottom(true);
  } catch (e: any) {
    if (uploadedTempUrls.length > 0 && userMsg.mediaUrls!.length === 0) {
      await deleteMediaUrls(uploadedTempUrls);
    }
    const msg = e?.response?.data?.message || e?.message || '发送失败，请稍后重试';
    errorMessage.value = msg;
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
};

const insertNewLine = () => {
  currentInput.value += '\n';
};

// 媒体上传相关函数
const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  if (!files) return;
  processFiles(Array.from(files));
  target.value = '';
};

const handleDrop = (event: DragEvent) => {
  const files = event.dataTransfer?.files;
  if (!files) return;
  processFiles(Array.from(files));
};

const inferMediaType = (file: File): 'image' | 'video' => {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  const lower = file.name.toLowerCase();
  if (lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm')) return 'video';
  return 'image';
};

const revokeMediaPreviewUrls = (items: UploadedMedia[]) => {
  for (const item of items) {
    if (item.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
};

const processFiles = (files: File[]) => {
  for (const file of files) {
    const type = inferMediaType(file);
    uploadedMedia.value.push({
      file,
      previewUrl: URL.createObjectURL(file),
      type,
      fileName: file.name,
    });
  }
};

const removeMedia = (index: number) => {
  const item = uploadedMedia.value[index];
  if (item?.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(item.previewUrl);
  }
  uploadedMedia.value.splice(index, 1);
};

const previewMedia = (media: UploadedMedia) => {
  if (media.type === 'image') {
    previewMediaUrl.value = media.previewUrl;
    showPreview.value = true;
    return;
  }
  previewVideoUrl.value = media.previewUrl;
  showVideoPreview.value = true;
};

const closePreview = () => {
  showPreview.value = false;
  previewMediaUrl.value = '';
};

const closeVideoPreview = () => {
  showVideoPreview.value = false;
  previewVideoUrl.value = '';
};

onMounted(() => {
  loadDockSettings();
  loadInputHeight();
  void loadSessionsFromServer();
  window.addEventListener('beforeunload', () => {
    void saveActiveSessionToServer();
  });
  window.addEventListener('resize', onWindowResize);
  const onBridgeMessage = (msg: ChatBridgeMessage) => {
    if (msg.type === 'sessions-refresh') {
      void loadSessionsFromServer();
      return;
    }
    if (msg.type === 'popup-closed' && !isPopupMode.value) {
      void loadSessionsFromServer();
    }
  };
  unsubscribeBridge = isPopupMode.value
    ? popupBridge!.onMessage(onBridgeMessage)
    : subscribeChatBridge(onBridgeMessage);
  if (isPopupMode.value) {
    void scrollToBottom(true);
  }
});

const onWindowResize = () => {
  panelWidth.value = clampPanelWidth(panelWidth.value);
  persistPanelWidth();
  if (dockSide.value === 'floating' && panelPos.value) {
    panelPos.value = clampPanelPosition(panelPos.value.x, panelPos.value.y);
    persistPanelPosition();
  }
};

onUnmounted(() => {
  unsubscribeBridge?.();
  if (refreshSignalTimer) {
    clearTimeout(refreshSignalTimer);
    refreshSignalTimer = null;
  }
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = null;
  }
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('mousemove', onPanelDragMove);
  document.removeEventListener('mouseup', onPanelDragEnd);
  document.removeEventListener('touchmove', onPanelTouchMove);
  document.removeEventListener('touchend', onPanelTouchEnd);
  document.removeEventListener('mousemove', onInputResizeMouseMove);
  document.removeEventListener('mouseup', endInputResize);
  document.removeEventListener('touchmove', onInputResizeTouchMove);
  document.removeEventListener('touchend', endInputResize);
  document.removeEventListener('mousemove', onWidthResizeMouseMove);
  document.removeEventListener('mouseup', endWidthResize);
  document.removeEventListener('touchmove', onWidthResizeTouchMove);
  document.removeEventListener('touchend', endWidthResize);
  revokeMediaPreviewUrls(uploadedMedia.value);
});
</script>

<style scoped>
.workflow-chat-toggle {
  position: fixed;
  right: 24px;
  top: 15%;
  z-index: 10050;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  line-height: 0;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
  transition: transform 0.15s ease, filter 0.15s ease;
}

.workflow-chat-toggle:hover {
  transform: scale(1.06);
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.55));
}

.workflow-chat-toggle:active {
  transform: scale(0.98);
}

.workflow-chat-toggle-icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
  display: block;
  pointer-events: none;
}

.workflow-chat-panel {
  position: fixed;
  z-index: 10049;
  width: var(--chat-panel-width, 480px);
  max-width: 100vw;
  background: var(--app-bg);
  border: 1px solid var(--app-border-strong);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow 0.15s ease;
}

.workflow-chat-panel.is-docked-right {
  right: 0;
  top: 0;
  bottom: 0;
  left: auto;
  height: 100vh;
  transform: none;
  border-radius: 16px 0 0 16px;
}

.workflow-chat-panel.is-docked-left {
  left: 0;
  top: 0;
  bottom: 0;
  right: auto;
  height: 100vh;
  transform: none;
  border-radius: 0 16px 16px 0;
}

.workflow-chat-panel.is-floating {
  height: 80vh;
  max-height: calc(100vh - 16px);
  border-radius: 24px;
}

.workflow-chat-panel.is-dragging {
  box-shadow: 0 28px 56px rgba(0, 0, 0, 0.65);
  user-select: none;
}

.workflow-chat-panel.is-width-resizing {
  user-select: none;
}

.workflow-chat-panel.show-snap-hint {
  outline: 2px solid var(--color-primary, #409eff);
  outline-offset: 2px;
}

.chat-panel-width-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 6;
  touch-action: none;
}

.chat-panel-width-resize-handle.is-right-edge {
  left: auto;
  right: 0;
}

.chat-panel-width-resize-handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 40px;
  border-radius: 999px;
  background: var(--app-border-strong, #4b5563);
  opacity: 0.45;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.chat-panel-width-resize-handle:hover::before,
.workflow-chat-panel.is-width-resizing .chat-panel-width-resize-handle::before {
  opacity: 1;
  background: var(--color-primary, #409eff);
}

.chat-panel-drag-strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--app-surface-soft, rgba(255, 255, 255, 0.04));
  border-bottom: 1px solid var(--app-border-color);
  color: var(--text-muted);
  font-size: 12px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  min-width: 0;
}

.workflow-chat-panel.is-layout-narrow .chat-panel-drag-strip span {
  display: none;
}

.workflow-chat-panel.is-layout-narrow .chat-panel-drag-strip {
  justify-content: center;
  padding: 4px 8px;
}

.chat-panel-drag-strip:active {
  cursor: grabbing;
}

.chat-panel-corner-grip {
  position: absolute;
  left: 6px;
  bottom: 6px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: var(--text-soft);
  cursor: grab;
  z-index: 3;
  touch-action: none;
}

.chat-panel-corner-grip:active {
  cursor: grabbing;
}

.chat-snap-hint {
  position: absolute;
  left: 50%;
  bottom: 42px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--color-primary, #409eff);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
  z-index: 4;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
}

.chat-header-draggable {
  cursor: grab;
  touch-action: none;
}

.chat-header-draggable:active,
.workflow-chat-panel.is-dragging .chat-header-draggable {
  cursor: grabbing;
}

.chat-drag-hint {
  margin-right: 6px;
  opacity: 0.55;
  vertical-align: -2px;
}

.workflow-chat-panel.popup-mode {
  left: 0;
  top: 0;
  bottom: 0;
  right: 0;
  width: 100%;
  max-width: none;
  transform: none;
  border-radius: 0;
  border: none;
  box-shadow: none;
  z-index: 1;
}

.chat-popup-root {
  width: 100%;
  height: 100%;
}

.chat-popup-warning {
  margin: 8px 16px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(230, 162, 60, 0.15);
  color: var(--color-warning, #e6a23c);
  font-size: 12px;
}

.message-media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.message-media-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--app-border-color);
}

.message-media-video-thumb {
  position: relative;
  width: 120px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--app-border-color);
  background: rgba(0, 0, 0, 0.25);
}

.message-media-video-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.message-media-video-badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
}

.media-video-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.chat-video-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.chat-video-preview-panel {
  position: relative;
  width: min(960px, 100%);
  max-height: 90vh;
  background: #111;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.chat-video-preview-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
}

.chat-video-preview-player {
  width: 100%;
  max-height: 90vh;
  display: block;
  background: #000;
}

.workflow-chat-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.workflow-chat-sessions {
  flex: 0 0 220px;
  min-width: 180px;
  border-right: 1px solid var(--app-border-color);
  display: flex;
  flex-direction: column;
  background: var(--app-bg-sub);
}

.workflow-chat-sessions.is-right-side {
  border-right: none;
  border-left: 1px solid var(--app-border-color);
}

.sessions-collapsed-rail {
  flex: 0 0 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  background: var(--app-bg-sub);
  border-right: 1px solid var(--app-border-color);
}

.sessions-collapsed-rail.is-right-side {
  border-right: none;
  border-left: 1px solid var(--app-border-color);
}

.sessions-rail-spacer {
  flex: 1;
  min-height: 8px;
}

.sessions-rail-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.sessions-rail-btn:hover {
  background: var(--app-surface-soft);
  color: var(--text-main);
}

.sessions-rail-btn .el-icon {
  font-size: 18px;
}

.sessions-header {
  padding: 10px 10px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sessions-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.sessions-title {
  font-size: 14px;
  color: var(--text-soft);
  flex-shrink: 0;
  white-space: nowrap;
}

.sessions-side-switch-icon {
  display: inline-flex;
  align-items: center;
  gap: 0;
  line-height: 1;
  vertical-align: middle;
}

.sessions-side-switch-icon .el-icon {
  font-size: 12px;
}

.sessions-rail-btn .sessions-side-switch-icon .el-icon {
  font-size: 11px;
}

.sessions-list {
  flex: 1;
}

.session-item {
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 8px;
  margin: 4px 8px;
}

.session-item:hover {
  background: var(--app-surface-soft);
}

.session-item.active {
  background: var(--app-surface);
}

.session-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.session-title {
  flex: 1;
  font-size: 13px;
  color: var(--text-main);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete-btn {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.session-item:hover .session-delete-btn {
  opacity: 1;
}

.session-meta {
  font-size: 11px;
  color: var(--text-subtle);
}

.workflow-chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--app-border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-title {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 6px;
}

.chat-title-text {
  font-size: 15px;
  color: var(--text-main);
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}

.chat-actions :deep(.el-button) {
  color: var(--text-muted);
  margin-left: 0;
}

.chat-actions :deep(.el-button > span) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.workflow-chat-main.is-narrow .chat-action-label {
  display: none;
}

.workflow-chat-main.is-narrow .chat-actions :deep(.el-button) {
  padding: 6px;
}

.workflow-chat-main.is-narrow .chat-messages {
  padding: 8px 10px;
}

.workflow-chat-main.is-narrow .chat-input-area {
  padding: 6px 10px 10px;
}

.workflow-chat-main.is-narrow .chat-input-tip {
  display: none;
}

.workflow-chat-main.is-narrow .chat-input :deep(.el-input__count) {
  display: none;
}

.workflow-chat-main.is-narrow .message-bubble {
  max-width: 100%;
}

.workflow-chat-main.is-narrow .chat-input-actions {
  gap: 6px;
}

.chat-messages {
  flex: 1;
  padding: 10px 16px;
}

.messages-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-row {
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 80%;
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.message-row.user .message-bubble {
  background: var(--color-primary);
  color: var(--text-strong);
  border-bottom-right-radius: 2px;
}

.message-row.assistant .message-bubble {
  background: var(--app-surface);
  color: var(--text-soft);
  border-bottom-left-radius: 2px;
}

.message-time {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
}

.message-bubble.loading {
  font-style: italic;
  opacity: 0.8;
}

.chat-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-danger);
}

.chat-input-area {
  padding: 8px 16px 12px;
  border-top: 1px solid var(--app-border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-input {
  flex: 1;
  min-height: 0;
  height: auto;
}

.chat-input :deep(.el-textarea) {
  height: 100%;
}

.chat-input :deep(textarea) {
  height: 100% !important;
  min-height: 100% !important;
  resize: none;
  background: #111827;
  border-color: #374151;
  color: var(--text-soft);
}

.chat-input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-input-tip {
  font-size: 11px;
  color: var(--text-muted);
}

.chat-input-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-input-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px dashed transparent;
  border-radius: 8px;
  transition: border-color 0.2s;
  min-height: 96px;
}

.chat-input-resize-handle {
  flex-shrink: 0;
  height: 8px;
  margin: -2px -2px 4px;
  border-radius: 8px 8px 0 0;
  cursor: ns-resize;
  touch-action: none;
  background: transparent;
  position: relative;
}

.chat-input-resize-handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: var(--app-border-strong, #4b5563);
  opacity: 0.65;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.chat-input-resize-handle:hover::before,
.chat-input-wrapper.is-input-resizing .chat-input-resize-handle::before {
  opacity: 1;
  background: var(--color-primary, #409eff);
}

.chat-input-wrapper.drag-over {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}

.file-input-hidden {
  display: none;
}

.uploaded-media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.media-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--app-border-color);
}

.media-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-thumbnail.video-placeholder {
  position: relative;
  overflow: hidden;
  background: var(--app-surface);
  cursor: pointer;
}

.video-icon {
  font-size: 24px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.video-label {
  font-size: 10px;
  color: var(--text-muted);
}

.media-remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  padding: 0;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
}

.media-item:hover .media-remove-btn {
  opacity: 1;
}

.media-remove-btn :deep(.el-icon) {
  font-size: 12px;
}

.workflow-chat-fade-enter-active,
.workflow-chat-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.workflow-chat-fade-enter-from,
.workflow-chat-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (max-width: 768px) {
  .workflow-chat-panel {
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
    transform: none;
    width: 100vw;
    border-radius: 0;
    height: 100vh;
  }

  .chat-panel-width-resize-handle {
    display: none;
  }

  .workflow-chat-toggle {
    bottom: 16px;
    top: auto;
    transform: none;
  }
}
</style>

