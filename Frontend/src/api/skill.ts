import request from '@/utils/request';
import { useUserStore } from '@/store/user';

export type SkillListItem = {
  id: number;
  name: string;
  description: string;
  visibility: string;
  status: string;
  owner_user_id: number;
  compat_flags: Record<string, unknown> | null;
  group: 'global' | 'mine' | 'draft' | 'other';
  created_at?: string;
  updated_at?: string;
};

export const listSkills = () => {
  return request.get<{ message: string; data: { skills: SkillListItem[] } }>('/skills');
};

export const getSkill = (id: number) => {
  return request.get(`/skills/${id}`);
};

export const importPrivateSkill = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return request.post('/skills/import', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const patchSkill = (id: number, data: { name?: string; description?: string; visibility?: 'private' | 'disabled' }) => {
  return request.patch(`/skills/${id}`, data);
};

export const deleteSkill = (id: number) => {
  return request.delete(`/skills/${id}`);
};

export const adminListSkills = () => {
  return request.get<{ message: string; data: { skills: SkillListItem[] } }>('/admin/skills');
};

export const adminImportSkill = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return request.post('/admin/skills/import', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const adminSetSkillVisibility = (id: number, visibility: 'draft' | 'global' | 'disabled') => {
  return request.patch(`/admin/skills/${id}/visibility`, { visibility });
};

export const adminDeleteSkill = (id: number) => {
  return request.delete(`/admin/skills/${id}`);
};

export async function downloadSkillPackage(id: number, asAdmin = false) {
  const userStore = useUserStore();
  const path = asAdmin ? `/api/admin/skills/${id}/package` : `/api/skills/${id}/package`;
  const resp = await fetch(path, {
    headers: { Authorization: `Bearer ${userStore.token}` },
  });
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}));
    throw new Error(j.message || '下载失败');
  }
  const blob = await resp.blob();
  const dispo = resp.headers.get('Content-Disposition') || '';
  const m = dispo.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const fileName = m ? decodeURIComponent(m[1].replace(/"/g, '')) : `skill-${id}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export type AgentStreamHandlers = {
  onTextDelta?: (text: string) => void;
  onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => void | Promise<void>;
  onAskUser?: (question: string) => void;
  onDone?: (payload: { text?: string }) => void;
  onState?: (state: any) => void;
  onError?: (message: string) => void;
};

async function readAgentSse(
  url: string,
  body: unknown,
  handlers: AgentStreamHandlers
): Promise<{ lastState: any }> {
  const userStore = useUserStore();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userStore.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}));
    throw new Error(j.message || `Agent 请求失败 ${resp.status}`);
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('无法读取流');
  const decoder = new TextDecoder();
  let buf = '';
  let lastState: any = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const chunk of parts) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const json = line.slice(6);
      let ev: any;
      try {
        ev = JSON.parse(json);
      } catch {
        continue;
      }
      if (ev.type === 'text_delta') handlers.onTextDelta?.(ev.text || '');
      else if (ev.type === 'tool_call') await handlers.onToolCall?.(ev);
      else if (ev.type === 'ask_user') handlers.onAskUser?.(ev.question || '');
      else if (ev.type === 'done') handlers.onDone?.({ text: ev.text });
      else if (ev.type === 'error') handlers.onError?.(ev.message || 'error');
      else if (ev.type === 'state') {
        lastState = ev;
        handlers.onState?.(ev);
      }
    }
  }
  return { lastState };
}

export async function runWorkflowAgent(params: {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  workflowContext?: unknown;
  skillIds?: number[];
  mediaUrls?: string[];
  executeTool: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<string>;
  handlers: AgentStreamHandlers;
}) {
  let state = await readAgentSse(
    '/api/prompt/agent/stream',
    {
      message: params.message,
      history: params.history,
      workflowContext: params.workflowContext,
      skillIds: params.skillIds,
      mediaUrls: params.mediaUrls,
    },
    params.handlers
  );

  let round = 1;
  while (state.lastState?.wait_client && round < 8) {
    const pending = state.lastState;
    const msgs = pending.messages || [];
    // 从前一次 SSE 收集的 tool_call 需要在 handlers 里攒起来——这里简化：由调用方在 onToolCall 里执行并缓存结果
    break;
  }
  return state;
}

/** 完整客户端工具循环 */
export async function runWorkflowAgentLoop(params: {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  workflowContext?: unknown;
  skillIds?: number[];
  mediaUrls?: string[];
  executeTool: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<string>;
  onTextDelta?: (text: string) => void;
  onAskUser?: (q: string) => void;
}) {
  const pendingCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
  let messages: any[] | null = null;
  let round = 1;

  const handlers: AgentStreamHandlers = {
    onTextDelta: params.onTextDelta,
    onAskUser: params.onAskUser,
    onToolCall: (call) => {
      pendingCalls.push({
        id: call.id,
        name: call.name,
        arguments: call.arguments || {},
      });
    },
    onState: (s) => {
      if (s?.messages) messages = s.messages;
      if (typeof s?.round === 'number') round = s.round;
    },
    onError: (m) => {
      throw new Error(m);
    },
  };

  await readAgentSse(
    '/api/prompt/agent/stream',
    {
      message: params.message,
      history: params.history,
      workflowContext: params.workflowContext,
      skillIds: params.skillIds,
      mediaUrls: params.mediaUrls,
    },
    handlers
  );

  while (pendingCalls.length && messages && round < 8) {
    const batch = pendingCalls.splice(0, pendingCalls.length);
    const tool_results = [];
    for (const c of batch) {
      const content = await params.executeTool(c);
      tool_results.push({ tool_call_id: c.id, content });
    }
    await readAgentSse(
      '/api/prompt/agent/continue',
      { messages, tool_results, round: round + 1 },
      handlers
    );
  }
}
