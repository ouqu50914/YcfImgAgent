import type { Response } from "express";

type AdminClient = {
    res: Response;
};

/**
 * 简易内存通知服务：
 * - 仅支持“在线”超级管理员收到通知（不做离线落库/推送）
 * - SSE 连接中断后会自动移除客户端
 */
export class NotificationService {
    private adminClients = new Set<AdminClient>();

    addAdminClient(res: Response) {
        const client: AdminClient = { res };
        this.adminClients.add(client);
        return client;
    }

    removeAdminClient(client: AdminClient) {
        this.adminClients.delete(client);
    }

    /**
     * 向所有已连接的超级管理员推送 SSE 事件
     * @param event SSE event 名
     * @param payload 事件内容（会被 JSON.stringify）
     */
    emitAdmin(event: string, payload: unknown) {
        const data = JSON.stringify(payload ?? {});
        const eventBlock = `event: ${event}\n` + `data: ${data}\n\n`;

        for (const client of this.adminClients) {
            try {
                client.res.write(eventBlock);
            } catch {
                // 写入失败，认为连接已断开
                this.adminClients.delete(client);
            }
        }
    }
}

export const notificationService = new NotificationService();

