import request from '@/utils/request';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiChatRequest {
  message: string;
  history?: ChatHistoryItem[];
  workflowContext?: any;
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiChatResponse {
  reply: string;
}

export const sendGeminiChat = (data: GeminiChatRequest) => {
  return request.post<{ message: string; data: GeminiChatResponse }>('/prompt/gemini-chat', data);
};

// 流式聊天：使用 fetch + ReadableStream 逐块读取
export const sendGeminiChatStream = async (
  data: GeminiChatRequest,
  onChunk: (delta: string) => void,
) => {
  const token = localStorage.getItem('token');
  const resp = await fetch('/api/prompt/gemini-chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });

  if (resp.status === 401) {
    throw new Error('未登录或登录已过期，请重新登录后再试');
  }

  if (!resp.body) {
    throw new Error('当前环境不支持流式响应');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split('\n');
      const dataLine = lines.find((l) => l.startsWith('data: ')) || lines[0];
      if (!dataLine) continue;
      const payload = dataLine.replace(/^data:\s*/, '').trim();

      if (!payload || payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload) as any;
        const delta: string =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.text ??
          json?.delta?.text ??
          json?.content ??
          '';
        if (delta) onChunk(delta);
      } catch {
        onChunk(payload);
      }
    }
  }
}

