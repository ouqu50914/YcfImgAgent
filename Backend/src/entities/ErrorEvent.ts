import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity({ name: "error_event" })
@Index(["user_id", "created_at"])
@Index(["error_key", "created_at"])
@Index(["created_at"])
export class ErrorEvent {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id!: number;

    @Column({ type: "varchar", length: 64 })
    @Index()
    trace_id!: string;

    @Column({ type: "int", nullable: true, comment: "10xxx/20xxx/30xxx 业务数字码" })
    numeric_code?: number | null;

    @Column({ type: "varchar", length: 64 })
    @Index()
    error_key!: string;

    @Column({ type: "varchar", length: 32, comment: "SYSTEM / CLIENT / LLM" })
    category!: string;

    @Column({ type: "text", comment: "对用户/管理员展示的中文说明" })
    message_zh!: string;

    @Column({ type: "text", nullable: true, comment: "原始英文或堆栈摘要，截断入库" })
    message_raw?: string | null;

    @Column({ type: "smallint", nullable: true })
    http_status?: number | null;

    @Column({ type: "varchar", length: 32, comment: "middleware / controller / adapter" })
    source!: string;

    @Column({ type: "varchar", length: 64, nullable: true })
    provider?: string | null;

    @Column({ type: "varchar", length: 255, nullable: true, comment: "上游 error.code" })
    provider_code?: string | null;

    @Column({ type: "bigint", nullable: true })
    @Index()
    user_id?: number | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    request_path?: string | null;

    @Column({ type: "varchar", length: 16, nullable: true })
    method?: string | null;

    @Column({ type: "json", nullable: true, comment: "脱敏上下文 JSON" })
    context?: Record<string, unknown> | null;

    @CreateDateColumn()
    created_at!: Date;
}
