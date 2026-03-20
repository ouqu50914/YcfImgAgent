type AdminCreditApplicationCreatedData = {
  id: number;
  userId: number;
  username: string;
  amount: number;
  reason?: string | null;
  createdAt?: string;
};

export type AdminSseEvent =
  | { event: "credit_application_created"; data: AdminCreditApplicationCreatedData }
  | { event: "ping"; data?: unknown }
  | { event: string; data?: unknown };

type ConnectOptions = {
  token: string;
  onEvent: (e: AdminSseEvent) => void;
};

const parseSseBlock = (block: string): AdminSseEvent | null => {
  // 典型 SSE block:
  // event: xxx
  // data: {...}
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(":")) continue; // comment

    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice("event:".length).trim();
      continue;
    }

    if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice("data:".length).trim());
      continue;
    }
  }

  const dataStr = dataLines.join("\n");
  let data: unknown = undefined;
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }
  }

  return { event: eventName, data } as AdminSseEvent;
};

/**
 * 建立“超级管理员” SSE 流（使用 fetch，以便带 Authorization header）
 * 返回 close() 用于断开连接
 */
export function connectAdminNotificationStream(opts: ConnectOptions): { close: () => void } {
  const url = "/api/notifications/admin/stream";

  let closed = false;
  let controller: AbortController | null = null;

  const close = () => {
    closed = true;
    controller?.abort();
  };

  const run = async () => {
    const retryDelayMs = 3000;
    while (!closed) {
      try {
        controller = new AbortController();

        const resp = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${opts.token}`
          },
          signal: controller.signal
        });

        if (!resp.ok) {
          throw new Error(`SSE HTTP ${resp.status}`);
        }

        const body = resp.body;
        if (!body) {
          throw new Error("SSE body is empty");
        }

        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE block 以空行分隔（\n\n）
          let idx = buffer.indexOf("\n\n");
          while (idx !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf("\n\n");

            const parsed = parseSseBlock(block);
            if (!parsed) continue;

            // ping 可以直接丢弃，但依然给回调以便调试（由上层自行忽略）
            opts.onEvent(parsed);
          }
        }
      } catch (e) {
        if (closed) return;
        // 断线重连
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  };

  // 不阻塞调用方
  void run();

  return { close };
}

