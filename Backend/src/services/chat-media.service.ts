import { IsNull } from "typeorm";
import { AppDataSource } from "../data-source";
import { ChatMedia } from "../entities/ChatMedia";
import { deleteChatTempMediaUrls } from "./chat-temp-media.service";

export const CHAT_MEDIA_EXPIRES_DAYS = 15;

export class ChatMediaService {
    private repo = AppDataSource.getRepository(ChatMedia);

    async registerChatMedia(userId: number, url: string, sessionId?: string): Promise<void> {
        const existing = await this.repo.findOne({
            where: { user_id: userId, url, deleted_at: IsNull() },
        });
        if (existing) return;

        const record = this.repo.create({
            user_id: userId,
            url,
        });
        if (sessionId) {
            record.session_id = sessionId;
        }
        await this.repo.save(record);
    }

    async deleteChatMediaByUrls(userId: number, urls: string[]): Promise<void> {
        const safe = urls.filter((u) => typeof u === "string" && u.trim());
        if (safe.length === 0) return;

        await deleteChatTempMediaUrls(safe);

        const now = new Date();
        for (const url of safe) {
            const records = await this.repo.find({
                where: { user_id: userId, url: url.trim(), deleted_at: IsNull() },
            });
            for (const r of records) {
                r.deleted_at = now;
                await this.repo.save(r);
            }
        }
    }

    async deleteExpiredChatMedia(): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - CHAT_MEDIA_EXPIRES_DAYS);

        const expired = await this.repo
            .createQueryBuilder("cm")
            .where("cm.deleted_at IS NULL")
            .andWhere("cm.created_at < :cutoff", { cutoff })
            .getMany();

        if (expired.length === 0) return 0;

        const urls = [...new Set(expired.map((r) => r.url))];
        await deleteChatTempMediaUrls(urls);

        const now = new Date();
        for (const r of expired) {
            r.deleted_at = now;
            await this.repo.save(r);
        }

        return expired.length;
    }
}
