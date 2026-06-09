import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity({ name: "chat_media" })
@Index(["user_id", "created_at"])
@Index(["url"])
export class ChatMedia {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id!: number;

    @Column({ type: "bigint", comment: "用户ID" })
    @Index()
    user_id!: number;

    @Column({ length: 512, comment: "媒体 URL，如 /uploads/chat-temp/chat_xxx.jpg" })
    url!: string;

    @Column({ length: 128, nullable: true, comment: "前端会话 ID" })
    session_id?: string;

    @CreateDateColumn()
    created_at!: Date;

    @Column({ type: "datetime", nullable: true, comment: "软删除时间" })
    deleted_at?: Date | null;
}
