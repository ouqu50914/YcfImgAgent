import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "video_task" })
export class VideoTask {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id!: number;

    @Column({ type: "bigint", comment: "关联用户ID" })
    user_id!: number;

    @Column({ length: 20, comment: "提供方，如 kling" })
    provider!: string;

    @Column({ length: 20, comment: "任务类型，如 text_to_video/image_to_video/omni" })
    type!: string;

    @Column({ type: "json", nullable: true, comment: "原始请求参数快照" })
    request_params!: any | null;

    @Column({ type: "varchar", length: 100, nullable: true, comment: "第三方任务ID" })
    provider_task_id!: string | null;

    @Column({ length: 20, default: "pending", comment: "任务状态：pending/running/succeeded/failed/canceled" })
    status!: string;

    @Column({ type: "int", nullable: true, comment: "进度百分比 0-100" })
    progress!: number | null;

    @Column({ type: "text", nullable: true, comment: "失败原因或错误信息" })
    error_message!: string | null;

    @Column({ type: "json", nullable: true, comment: "生成的视频URL数组（本地或远程）" })
    video_urls!: string[] | null;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;

    @Column({ type: "datetime", nullable: true })
    finished_at!: Date | null;
}

