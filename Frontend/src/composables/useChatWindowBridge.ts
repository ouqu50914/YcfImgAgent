import { ref, onUnmounted } from 'vue';

export const CHAT_BRIDGE_CHANNEL = 'workflow-gemini-chat';

export type ChatBridgeMessage =
  | { type: 'context-update'; payload: unknown }
  | { type: 'gemini-command'; payload: unknown }
  | { type: 'popup-closed' }
  | { type: 'sessions-refresh' };

type BridgeHandler = (msg: ChatBridgeMessage) => void;

let sharedChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    sharedChannel = new BroadcastChannel(CHAT_BRIDGE_CHANNEL);
  }
  return sharedChannel;
}

export function postChatBridgeMessage(msg: ChatBridgeMessage) {
  const ch = getChannel();
  ch?.postMessage(msg);
}

export function subscribeChatBridge(handler: BridgeHandler) {
  const ch = getChannel();
  const listener = (ev: MessageEvent<ChatBridgeMessage>) => {
    const msg = ev.data;
    if (msg?.type) handler(msg);
  };
  ch?.addEventListener('message', listener);
  return () => ch?.removeEventListener('message', listener);
}

export function useChatWindowBridge(role: 'main' | 'popup') {
  const workflowContext = ref<unknown>(null);
  const mainWindowClosed = ref(false);
  const handlers: BridgeHandler[] = [];

  const onMessage = (handler: BridgeHandler) => {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  };

  const ch = getChannel();
  const listener = (ev: MessageEvent<ChatBridgeMessage>) => {
    const msg = ev.data;
    if (!msg?.type) return;

    if (msg.type === 'context-update' && role === 'popup') {
      workflowContext.value = msg.payload;
      mainWindowClosed.value = false;
    }

    handlers.forEach((h) => h(msg));
  };

  if (ch) {
    ch.addEventListener('message', listener);
  }

  const broadcastContext = (ctx: unknown) => {
    postChatBridgeMessage({ type: 'context-update', payload: ctx });
  };

  const sendGeminiCommand = (cmd: unknown) => {
    postChatBridgeMessage({ type: 'gemini-command', payload: cmd });
  };

  const notifyPopupClosed = () => {
    postChatBridgeMessage({ type: 'popup-closed' });
  };

  if (role === 'popup') {
    const checkOpener = () => {
      mainWindowClosed.value = !window.opener || window.opener.closed;
    };
    checkOpener();
    const timer = window.setInterval(checkOpener, 1500);
    onUnmounted(() => {
      window.clearInterval(timer);
      notifyPopupClosed();
    });
  }

  onUnmounted(() => {
    ch?.removeEventListener('message', listener);
  });

  return {
    workflowContext,
    mainWindowClosed,
    onMessage,
    broadcastContext,
    sendGeminiCommand,
    notifyPopupClosed,
  };
}

let chatPopupRef: Window | null = null;

function resolveChatPopupUrl(): string {
  const base = import.meta.env.BASE_URL || '/agent/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${normalizedBase}workflow/chat-popup`, window.location.origin).href;
}

export function openChatPopup(): Window | null {
  if (chatPopupRef && !chatPopupRef.closed) {
    chatPopupRef.focus();
    return chatPopupRef;
  }

  const url = resolveChatPopupUrl();
  const width = 560;
  const height = 820;
  const left = Math.max(0, window.screenX + window.outerWidth - width - 24);
  const top = Math.max(0, window.screenY + 48);
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  const popup = window.open(url, 'workflow-gemini-chat', features);

  if (!popup) return null;

  chatPopupRef = popup;
  try {
    popup.focus();
  } catch {
    // ignore
  }

  popup.addEventListener('beforeunload', () => {
    if (chatPopupRef === popup) {
      chatPopupRef = null;
    }
    postChatBridgeMessage({ type: 'popup-closed' });
  });

  return popup;
}

export function isChatPopupOpen(): boolean {
  return !!(chatPopupRef && !chatPopupRef.closed);
}
