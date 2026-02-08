import path from "path";
import fs from "fs";
import { AppDataSource } from "../data-source";
import { WorkflowHistory } from "../entities/WorkflowHistory";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

/** 从 workflow_data 和 cover_image 中收集 /uploads/ 下的文件名（含所有节点类型中的图片引用） */
function collectUploadFilenames(workflowData: any, coverImage?: string | null): string[] {
    const names: string[] = [];
    const add = (url: string | undefined | null) => {
        if (!url || typeof url !== "string") return;
        const m = url.match(/\/uploads\/([^/?]+)/);
        if (m && m[1]) names.push(m[1]);
    };
    add(coverImage);
    if (workflowData && typeof workflowData === "object") {
        const nodes = workflowData.nodes || [];
        for (const node of nodes) {
            const d = node?.data;
            if (!d) continue;
            add(d.imageUrl);
            add(d.originalImageUrl);
            add(d.image_url);
            if (Array.isArray(d.imageUrls)) for (const u of d.imageUrls) add(u);
            const lr = d.layerResult;
            if (lr?.layers && Array.isArray(lr.layers)) {
                for (const layer of lr.layers) add(layer?.url);
            }
        }
        add(workflowData.cover_image);
    }
    return [...new Set(names)];
}

/** 删除历史记录关联的 uploads 文件 */
function deleteHistoryFiles(workflowDataRaw: string) {
    let data: any;
    try {
        data = JSON.parse(workflowDataRaw);
    } catch {
        data = null;
    }
    const coverImage = data?.cover_image;
    const filenames = collectUploadFilenames(data, coverImage);
    for (const name of filenames) {
        const filePath = path.join(UPLOADS_DIR, name);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.warn("deleteHistoryFiles unlink failed:", filePath, e);
        }
    }
}

export class WorkflowHistoryService {
    private historyRepo = AppDataSource.getRepository(WorkflowHistory);

    /**
     * 自动保存工作流历史。若传入 historyId 且属于当前用户则覆盖该条，否则新建（并保留最近20条）。
     */
    async autoSave(userId: number, workflowData: any, historyId?: number) {
        if (historyId != null) {
            const existing = await this.historyRepo.findOne({
                where: { id: historyId, user_id: userId }
            });
            if (existing) {
                existing.workflow_data = JSON.stringify(workflowData);
                existing.snapshot_name = `自动保存 ${new Date().toLocaleString('zh-CN')}`;
                await this.historyRepo.save(existing);
                return existing;
            }
        }

        const history = new WorkflowHistory();
        history.user_id = userId;
        history.workflow_data = JSON.stringify(workflowData);
        history.snapshot_name = `自动保存 ${new Date().toLocaleString('zh-CN')}`;

        await this.historyRepo.save(history);

        // 删除旧的历史记录：非公开且未收藏的只保留最近20条，公开或收藏的永久保留
        const allHistories = await this.historyRepo.find({
            where: { user_id: userId },
            order: { created_at: 'DESC' }
        });
        const toPrune = allHistories.filter((h) => (h.is_public ?? 0) === 0 && (h.is_favorite ?? 0) === 0);
        if (toPrune.length > 20) {
            const toDelete = toPrune.slice(20);
            for (const h of toDelete) deleteHistoryFiles(h.workflow_data);
            await this.historyRepo.remove(toDelete);
        }

        return history;
    }

    /**
     * 获取用户的工作流历史列表（含解析出的 cover_image 供列表展示）
     */
    async getHistoryList(userId: number, limit: number = 20) {
        const list = await this.historyRepo.find({
            where: { user_id: userId },
            order: { updated_at: 'DESC', created_at: 'DESC' },
            take: limit
        });
        return list.map((h) => {
            let cover_image: string | undefined;
            try {
                const data = JSON.parse(h.workflow_data) as { cover_image?: string };
                cover_image = data?.cover_image;
            } catch {
                // ignore
            }
            return {
                id: h.id,
                user_id: h.user_id,
                workflow_data: h.workflow_data,
                snapshot_name: h.snapshot_name,
                created_at: h.created_at,
                updated_at: h.updated_at ?? h.created_at,
                is_public: h.is_public ?? 0,
                is_favorite: h.is_favorite ?? 0,
                cover_image
            };
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
     * 更新历史记录（公开、收藏）
     */
    async updateHistory(historyId: number, userId: number, updates: { isPublic?: boolean; isFavorite?: boolean }) {
        const history = await this.historyRepo.findOne({
            where: { id: historyId, user_id: userId }
        });
        if (!history) throw new Error('历史记录不存在');
        if (updates.isPublic !== undefined) history.is_public = updates.isPublic ? 1 : 0;
        if (updates.isFavorite !== undefined) history.is_favorite = updates.isFavorite ? 1 : 0;
        await this.historyRepo.save(history);
        return history;
    }

    /**
     * 删除历史记录并删除关联的上传图片文件
     */
    async deleteHistory(historyId: number, userId: number) {
        const history = await this.historyRepo.findOne({
            where: { id: historyId, user_id: userId }
        });

        if (!history) {
            throw new Error('历史记录不存在');
        }

        deleteHistoryFiles(history.workflow_data);
        await this.historyRepo.remove(history);
        return { message: '历史记录删除成功' };
    }
}
