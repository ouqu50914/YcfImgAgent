import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity({ name: 'image_result' })
@Index(["template_id"])
export class ImageResult {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '关联用户ID' })
    user_id!: number;

    @Column({ length: 20 })
    api_type!: string;

    @Column({ type: "varchar", length: 100, nullable: true, comment: "真实模型名，如 gpt-image-2 / gemini-3-pro-image-preview" })
    model_name!: string | null;

    @Column({ type: "varchar", length: 50, nullable: true, comment: "模型平台，如 ace/anyfast/dream/nano" })
    model_provider!: string | null;

    @Column({ type: 'text', nullable: true })
    prompt!: string;

    @Column({
        type: 'varchar',
        length: 64,
        nullable: true,
        comment: '前端生成时传入的幂等 key，用于刷新/历史恢复后查询生成结果'
    })
    generation_key!: string;

    @Column({
        type: 'varchar',
        length: 128,
        nullable: true,
        comment: '第三方模型返回的任务ID'
    })
    provider_task_id!: string | null;

    @Column({ length: 255, nullable: true, comment: '图片存储路径' })
    image_url!: string;

    @Column({ type: 'longtext', nullable: true, comment: '多图生成结果（JSON 数组）' })
    all_images!: string;

    @Column({ type: 'longtext', nullable: true, comment: '上游原始结果（JSON 数组），用于首屏快速回显' })
    upstream_images!: string | null;

    @Column({ type: 'varchar', length: 20, default: 'pending', comment: '图片转存同步状态：pending/syncing/synced/failed' })
    sync_status!: string;

    @Column({ type: 'text', nullable: true, comment: '图片转存失败原因' })
    sync_error!: string | null;

    @Column({ type: 'tinyint', default: 0, comment: '0-进行中 1-成功 2-失败' })
    status!: number;

    @Column({ type: 'bigint', nullable: true, comment: '关联 workflow_template.id' })
    template_id!: number | null;

    @Column({ type: 'int', nullable: true, comment: '本次操作消耗的积分' })
    credits_spent!: number | null;

    @Column({ length: 20, default: 'generate', comment: 'generate/upscale/extend/split' })
    operation_type!: string;

    @CreateDateColumn()
    created_at!: Date;
}