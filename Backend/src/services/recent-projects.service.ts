import { WorkflowService } from "./workflow.service";
import { WorkflowHistoryService } from "./workflow-history.service";

export type RecentProjectSource = 'template' | 'history';

export interface RecentProjectItem {
    id: number;
    name: string;
    preview?: string;
    created_at: string;
    updated_at: string;
    source: RecentProjectSource;
}

function toIsoString(value: Date | string): string {
    if (value instanceof Date) return value.toISOString();
    return new Date(value).toISOString();
}

export class RecentProjectsService {
    private workflowService = new WorkflowService();
    private historyService = new WorkflowHistoryService();

    /** 首页最近项目：轻量查询 + 服务端合并排序 */
    async getRecentProjects(userId: number, limit: number = 5): Promise<RecentProjectItem[]> {
        const [templates, histories] = await Promise.all([
            this.workflowService.getUserTemplatesLite(userId),
            this.historyService.getHistoryListLite(userId, 20),
        ]);

        const list: Array<RecentProjectItem & { _sortTime: number }> = [];

        for (const item of templates) {
            const t = new Date(item.updated_at || item.created_at).getTime();
            list.push({
                id: Number(item.id),
                name: item.name || '未命名工作流',
                ...(item.cover_image ? { preview: item.cover_image } : {}),
                created_at: toIsoString(item.created_at),
                updated_at: toIsoString(item.updated_at),
                source: 'template',
                _sortTime: t,
            });
        }

        const grouped: Record<string, typeof histories[number]> = {};
        for (const item of histories) {
            if (item.template_id != null) continue;
            const key = item.cover_image || `history_${item.id}`;
            const existing = grouped[key];
            if (!existing) {
                grouped[key] = item;
                continue;
            }
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const currentTime = new Date(item.updated_at || item.created_at).getTime();
            if (currentTime > existingTime) {
                grouped[key] = item;
            }
        }

        for (const item of Object.values(grouped)) {
            const t = new Date(item.updated_at || item.created_at).getTime();
            list.push({
                id: item.id,
                name: item.snapshot_name || '自动保存工作流',
                ...(item.cover_image ? { preview: item.cover_image } : {}),
                created_at: item.created_at.toISOString(),
                updated_at: item.updated_at.toISOString(),
                source: 'history',
                _sortTime: t,
            });
        }

        list.sort((a, b) => b._sortTime - a._sortTime);
        return list.slice(0, limit).map(({ _sortTime, ...rest }) => rest);
    }
}
