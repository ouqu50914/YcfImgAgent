import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity({ name: 'workflow_history' })
@Index(['user_id', 'created_at'])
export class WorkflowHistory {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    @Index()
    user_id!: number;

    @Column({ type: 'longtext', comment: '工作流数据（JSON格式）' })
    workflow_data!: string;

    @Column({ length: 200, nullable: true, comment: '快照名称（自动生成）' })
    snapshot_name?: string;

    @Column({ type: 'tinyint', default: 0, comment: '是否公开：0-私有，1-公开' })
    is_public!: number;

    @Column({ type: 'tinyint', default: 0, comment: '是否收藏：0-否，1-是' })
    is_favorite!: number;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
