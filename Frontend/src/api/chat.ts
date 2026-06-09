import request from '@/utils/request';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiChatRequest {
  message: string;
  history?: ChatHistoryItem[];
  workflowContext?: any;
  mediaUrls?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiChatResponse {
  reply: string;
}

/** 聊天临时媒体：上传至 COS 或本地 chat-temp，随会话生命周期清理 */
export const uploadChatMedia = (file: File, sessionId?: string) => {
  const formData = new FormData();
  formData.append('image', file);
  if (sessionId) {
    formData.append('sessionId', sessionId);
  }
  return request.post<{ message: string; data: { url: string; filename: string; size: number } }>(
    '/prompt/chat-media',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
};

export const deleteChatMedia = (urls: string[]) => {
  return request.post('/prompt/chat-media/delete', { urls });
};

export const sendGeminiChat = (data: GeminiChatRequest) => {
  return request.post<{ message: string; data: GeminiChatResponse }>('/prompt/gemini-chat', data);
};

const CHAT_STREAM_TIMEOUT_MS = 60_000;
const CHAT_STREAM_VIDEO_TIMEOUT_MS = 300_000;

function resolveChatStreamTimeoutMs(data: GeminiChatRequest): number {
  const urls = data.mediaUrls || [];
  const hasVideo = urls.some((u) => {
    const lower = u.toLowerCase();
    return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.webm') || lower.includes('.mkv');
  });
  return hasVideo ? CHAT_STREAM_VIDEO_TIMEOUT_MS : CHAT_STREAM_TIMEOUT_MS;
}

// 流式聊天：使用 fetch + ReadableStream 逐块读取
export const sendGeminiChatStream = async (
  data: GeminiChatRequest,
  onChunk: (delta: string) => void,
) => {
  const token = localStorage.getItem('token');
  const streamTimeoutMs = resolveChatStreamTimeoutMs(data);

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const resetStreamTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      controller.abort();
    }, streamTimeoutMs);
  };

  resetStreamTimeout();

  try {
    const resp = await fetch('/api/prompt/gemini-chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (resp.status === 401) {
      throw new Error('未登录或登录已过期，请重新登录后再试');
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `请求失败，状态码: ${resp.status}`);
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

      resetStreamTimeout();

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
          // 检查错误消息
          if (json?.error) {
            throw new Error(json.error.message || '请求失败');
          }
          const delta: string =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.text ??
            json?.delta?.text ??
            json?.content ??
            '';
          if (delta) {
            resetStreamTimeout();
            onChunk(delta);
          }
        } catch (parseError) {
          // 如果不是JSON格式，尝试作为纯文本处理
          if (payload.includes('error') || payload.includes('Error')) {
            throw new Error(payload);
          }
          onChunk(payload);
        }
      }
    }
  } catch (error: any) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      const mins = Math.round(streamTimeoutMs / 60000);
      throw new Error(`视频识别耗时较长，已超过 ${mins} 分钟仍未完成，请稍后重试或压缩视频后再试`);
    }
    throw error;
  }
}

