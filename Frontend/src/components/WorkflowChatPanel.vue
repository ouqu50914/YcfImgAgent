<template>
  <div>
    <el-button
      class="workflow-chat-toggle"
      circle
      type="primary"
      @click="togglePanel"
    >
      <el-icon>
        <ChatDotRound />
      </el-icon>
    </el-button>

    <transition name="workflow-chat-fade">
      <div
        v-if="isOpen"
        class="workflow-chat-panel"
      >
        <div class="workflow-chat-layout">
          <aside class="workflow-chat-sessions">
            <div class="sessions-header">
              <span class="sessions-title">会话</span>
              <div class="sessions-actions">
                <el-button
                  size="small"
                  type="primary"
                  text
                  @click="createSession"
                >
                  新建
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

          <section class="workflow-chat-main">
            <header class="chat-header">
              <div class="chat-title">
                {{ activeSession?.title || 'Gemini 助理' }}
              </div>
              <div class="chat-actions">
                <el-button
                  size="small"
                  text
                  @click="clearActiveSessionMessages"
                >
                  清空
                </el-button>
                <el-button
                  size="small"
                  text
                  @click="closePanel"
                >
                  关闭
                </el-button>
              </div>
            </header>

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
                    <div class="message-content">
                      {{ msg.content }}
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
              <el-input
                v-model="currentInput"
                type="textarea"
                :rows="3"
                class="chat-input"
                placeholder="除了输入文案向Gemini提仍和问题，还可以关联工作流基本信息，例如：选中某个节点，询问是做什么的、当前选中了哪些个节点、有什么适合的模板推荐、工作流整体结构说明、优化选中文案提示词等…"
                @keydown.enter.exact.prevent="handleSend"
                @keydown.enter.shift.prevent="insertNewLine"
              />
              <div class="chat-input-actions">
                <span class="chat-input-tip">Enter 发送，Shift+Enter 换行 · 可结合当前画布询问节点含义、连线方式、模板推荐等</span>
                <el-button
                  type="primary"
                  :loading="loading"
                  :disabled="!currentInput.trim() || loading"
                  @click="handleSend"
                >
                  发送
                </el-button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { ChatDotRound } from '@element-plus/icons-vue';
import { useUserStore } from '@/store/user';
import type { ChatHistoryItem, GeminiChatRequest } from '@/api/chat';
import { sendGeminiChat, sendGeminiChatStream } from '@/api/chat';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

const props = defineProps(['workflowContext']);

const userStore = useUserStore();

const isOpen = ref(false);
const sessions = ref<ChatSession[]>([]);
const activeSessionId = ref<string>('');
const currentInput = ref('');
const loading = ref(false);
const errorMessage = ref('');

const messagesScrollRef = ref();

const activeSession = computed(() =>
  sessions.value.find((s) => s.id === activeSessionId.value),
);

const storageKey = computed(() => {
  const id = userStore.userInfo?.id ?? 'anonymous';
  return `workflow_gemini_chat_sessions_${id}`;
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

const persistSessions = () => {
  try {
    window.localStorage.setItem(storageKey.value, JSON.stringify(sessions.value));
  } catch {
    // ignore storage error
  }
};

watch(
  sessions,
  () => {
    persistSessions();
  },
  { deep: true },
);

const scrollToBottom = async () => {
  await nextTick();
  const scrollComp = messagesScrollRef.value as any;
  if (scrollComp && scrollComp.wrapRef) {
    const el = scrollComp.wrapRef as HTMLElement;
    el.scrollTop = el.scrollHeight;
  }
};

const ensureDefaultSession = () => {
  if (sessions.value.length === 0) {
    const now = new Date().toISOString();
    const id = `session_${Date.now()}`;
    sessions.value.push({
      id,
      title: '新的会话',
      createdAt: now,
      messages: [],
    });
    activeSessionId.value = id;
  } else if (!activeSessionId.value) {
    activeSessionId.value = sessions.value[0]?.id ?? '';
  }
};

const loadFromStorage = () => {
  try {
    const raw = window.localStorage.getItem(storageKey.value);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed)) {
        sessions.value = parsed;
      }
    }
  } catch {
    // ignore parse error
  }
  ensureDefaultSession();
};

const togglePanel = () => {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    scrollToBottom();
  }
};

const closePanel = () => {
  isOpen.value = false;
};

const createSession = () => {
  const now = new Date().toISOString();
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: ChatSession = {
    id,
    title: '新的会话',
    createdAt: now,
    messages: [],
  };
  sessions.value.unshift(session);
  activeSessionId.value = id;
};

const setActiveSession = (id: string) => {
  activeSessionId.value = id;
  scrollToBottom();
};

const clearActiveSessionMessages = () => {
  if (!activeSession.value) return;
  activeSession.value.messages = [];
};

/** 删除指定会话；若删的是当前会话则切换到其他会话 */
const deleteSession = (sessionId: string) => {
  if (sessions.value.length <= 1) {
    sessions.value = [];
    ensureDefaultSession();
    persistSessions();
    return;
  }
  const idx = sessions.value.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  sessions.value.splice(idx, 1);
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = sessions.value[0]?.id ?? sessions.value[sessions.value.length - 1]?.id ?? '';
  }
  persistSessions();
};

const buildHistoryForRequest = (session: ChatSession): ChatHistoryItem[] => {
  const MAX_HISTORY = 10;
  const recent = session.messages.slice(-MAX_HISTORY);
  return recent.map((m) => ({
    role: m.role,
    content: m.content,
  }));
};

const buildWorkflowContext = () => {
  const base: any = { time: new Date().toISOString() };
  const anyProps: any = props || {};
  const ctx: any = anyProps.workflowContext;
  if (ctx && typeof ctx === 'object') {
    return { ...base, ...ctx };
  }
  return base;
};

const handleSend = async () => {
  const content = currentInput.value.trim();
  if (!content || loading.value) return;
  if (!activeSession.value) {
    ensureDefaultSession();
  }
  const session = activeSession.value!;

  const now = new Date().toISOString();
  const userMsg: ChatMessage = {
    id: `m_${Date.now()}_u`,
    role: 'user',
    content,
    createdAt: now,
  };
  session.messages.push(userMsg);

  if (!session.title || session.title === '新的会话') {
    session.title = content.slice(0, 20);
  }

  currentInput.value = '';
  errorMessage.value = '';
  await scrollToBottom();

  loading.value = true;
  try {
    const payload: GeminiChatRequest = {
      message: content,
      history: buildHistoryForRequest(session),
      workflowContext: buildWorkflowContext(),
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
    persistSessions();
  } catch (e: any) {
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

onMounted(() => {
  loadFromStorage();
  window.addEventListener('beforeunload', persistSessions);
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', persistSessions);
});
</script>

<style scoped>
.workflow-chat-toggle {
  position: fixed;
  right: 24px;
  top: 15%;
  z-index: 40;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.4);
}

.workflow-chat-panel {
  position: fixed;
  left: 50%;
  top: 10%;
  bottom: 10%;
  transform: translate(-50%, 0%);
  width: 60%;
  max-width: 100vw;
  z-index: 39;
  border-radius: 24px;
  background: var(--app-bg);
  border: 1px solid var(--app-border-strong);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workflow-chat-layout {
  display: flex;
  height: 100%;
}

.workflow-chat-sessions {
  flex: 0 0 160px;
  border-right: 1px solid var(--app-border-color);
  display: flex;
  flex-direction: column;
  background: var(--app-bg-sub);
}

.sessions-header {
  padding: 12px 12px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sessions-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sessions-title {
  font-size: 14px;
  color: var(--text-soft);
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
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-title {
  font-size: 15px;
  color: var(--text-main);
  font-weight: 500;
}

.chat-actions :deep(.el-button) {
  color: var(--text-muted);
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

.chat-input :deep(textarea) {
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
  }

  .workflow-chat-toggle {
    bottom: 16px;
    top: auto;
    transform: none;
  }
}
</style>

