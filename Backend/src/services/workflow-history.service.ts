import { AppDataSource } from "../data-source";
import { WorkflowHistory } from "../entities/WorkflowHistory";

export class WorkflowHistoryService {
    private historyRepo = AppDataSource.getRepository(WorkflowHistory);

    /**
     * 自动保存工作流历史（保留最近20条）
     */
    async autoSave(userId: number, workflowData: any) {
        const history = new WorkflowHistory();
        history.user_id = userId;
        history.workflow_data = JSON.stringify(workflowData);
        history.snapshot_name = `自动保存 ${new Date().toLocaleString('zh-CN')}`;

        await this.historyRepo.save(history);

        // 删除旧的历史记录，只保留最近20条
        const allHistories = await this.historyRepo.find({
            where: { user_id: userId },
            order: { created_at: 'DESC' }
        });

        if (allHistories.length > 20) {
            const toDelete = allHistories.slice(20);
            await this.historyRepo.remove(toDelete);
        }

        return history;
    }

    /**
     * 获取用户的工作流历史列表
     */
    async getHistoryList(userId: number, limit: number = 20) {
        return this.historyRepo.find({
            where: { user_id: userId },
            order: { created_at: 'DESC' },
            take: limit
        });
    }

    /**
     * 获取历史记录详情
     */
    async getHistory(historyId: number, userId: number) {
        const history = await this.historyRepo.findOne({
            where: { id: historyId, user_id: userId }
        });

        if (!history) {
            throw new Error('历史记录不存在');
        }

        return {
            ...history,
            workflow_data: JSON.parse(history.workflow_data)
        };
    }

    /**
     * 删除历史记录
     */
    async deleteHistory(historyId: number, userId: number) {
        const history = await this.historyRepo.findOne({
            where: { id: historyId, user_id: userId }
        });

        if (!history) {
            throw new Error('历史记录不存在');
        }

        await this.historyRepo.remove(history);
        return { message: '历史记录删除成功' };
    }
}
