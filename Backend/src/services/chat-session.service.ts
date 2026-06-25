import { IsNull, LessThan } from "typeorm";
import { AppDataSource } from "../data-source";
import { ChatSessionRecord } from "../entities/ChatSessionRecord";

export const CHAT_SESSION_EXPIRES_DAYS = 15;

export type ChatMessageRecord = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    mediaUrls?: string[];
};

export type ChatSessionDto = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessageRecord[];
};

function toIso(d: Date | string | undefined): string {
    if (!d) return new Date().toISOString();
    if (typeof d === "string") return d;
    return d.toISOString();
}

function normalizeMessages(raw: unknown): ChatMessageRecord[] {
    if (!Array.isArray(raw)) return [];
    const out: ChatMessageRecord[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        const role = m.role === "assistant" ? "assistant" : "user";
        if (typeof m.id !== "string" || typeof m.content !== "string") continue;
        const createdAt = typeof m.createdAt === "string" ? m.createdAt : new Date().toISOString();
        const mediaUrls = Array.isArray(m.mediaUrls)
            ? m.mediaUrls.filter((u): u is string => typeof u === "string")
            : [];
        out.push({
            id: m.id,
            role,
            content: m.content,
            createdAt,
            mediaUrls,
        });
    }
    return out;
}

function recordToDto(record: ChatSessionRecord): ChatSessionDto {
    let messages: ChatMessageRecord[] = [];
    try {
        messages = normalizeMessages(JSON.parse(record.messages_json || "[]"));
    } catch {
        messages = [];
    }
    return {
        id: record.id,
        title: record.title || "新的会话",
        createdAt: toIso(record.created_at),
        updatedAt: toIso(record.updated_at),
        messages,
    };
}

export class ChatSessionService {
    private repo = AppDataSource.getRepository(ChatSessionRecord);

    async listSessions(userId: number): Promise<ChatSessionDto[]> {
        await this.purgeExpiredSessions(userId);
        const rows = await this.repo.find({
            where: { user_id: userId, deleted_at: IsNull() },
            order: { updated_at: "DESC" },
        });
        return rows.map(recordToDto);
    }

    async upsertSession(userId: number, session: ChatSessionDto): Promise<ChatSessionDto> {
        if (!session?.id || typeof session.id !== "string") {
            throw new Error("会话 ID 无效");
        }
        const messages = normalizeMessages(session.messages);
        const title = (session.title || "新的会话").slice(0, 200);
        const createdAt = session.createdAt ? new Date(session.createdAt) : new Date();
        const updatedAt = session.updatedAt ? new Date(session.updatedAt) : new Date();

        let record = await this.repo.findOne({
            where: { id: session.id, user_id: userId, deleted_at: IsNull() },
        });

        if (!record) {
            record = this.repo.create({
                id: session.id,
                user_id: userId,
                title,
                messages_json: JSON.stringify(messages),
                created_at: Number.isFinite(createdAt.getTime()) ? createdAt : new Date(),
                updated_at: Number.isFinite(updatedAt.getTime()) ? updatedAt : new Date(),
            });
        } else {
            record.title = title;
            record.messages_json = JSON.stringify(messages);
            record.updated_at = Number.isFinite(updatedAt.getTime()) ? updatedAt : new Date();
        }

        const saved = await this.repo.save(record);
        return recordToDto(saved);
    }

    async bulkUpsertSessions(userId: number, sessions: ChatSessionDto[]): Promise<number> {
        if (!Array.isArray(sessions)) return 0;
        let count = 0;
        for (const session of sessions) {
            if (!session?.id) continue;
            await this.upsertSession(userId, session);
            count += 1;
        }
        return count;
    }

    async deleteSession(userId: number, sessionId: string): Promise<boolean> {
        const record = await this.repo.findOne({
            where: { id: sessionId, user_id: userId, deleted_at: IsNull() },
        });
        if (!record) return false;
        record.deleted_at = new Date();
        await this.repo.save(record);
        return true;
    }

    async purgeExpiredSessions(userId?: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - CHAT_SESSION_EXPIRES_DAYS);

        const where: Record<string, unknown> = {
            deleted_at: IsNull(),
            updated_at: LessThan(cutoff),
        };
        if (userId) {
            where.user_id = userId;
        }

        const expired = await this.repo.find({ where: where as any });
        if (expired.length === 0) return 0;

        const now = new Date();
        for (const record of expired) {
            record.deleted_at = now;
            await this.repo.save(record);
        }
        return expired.length;
    }
}
