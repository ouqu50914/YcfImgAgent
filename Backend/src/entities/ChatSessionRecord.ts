import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

@Entity({ name: "chat_sessions" })
@Index(["user_id", "updated_at"])
export class ChatSessionRecord {
    @PrimaryColumn({ length: 64, comment: "前端会话 ID" })
    id!: string;

    @Column({ type: "bigint", comment: "用户ID" })
    @Index()
    user_id!: number;

    @Column({ length: 200, default: "新的会话" })
    title!: string;

    @Column({ type: "longtext", comment: "消息 JSON 数组" })
    messages_json!: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;

    @Column({ type: "datetime", nullable: true, comment: "软删除时间" })
    deleted_at?: Date | null;
}
