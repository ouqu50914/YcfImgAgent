import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

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

    @CreateDateColumn()
    created_at!: Date;
}
