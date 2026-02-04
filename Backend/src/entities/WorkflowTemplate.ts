import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity({ name: 'workflow_template' })
@Index(['user_id', 'created_at'])
export class WorkflowTemplate {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    @Index()
    user_id!: number;

    @Column({ length: 200, comment: '模板名称' })
    name!: string;

    @Column({ type: 'text', nullable: true, comment: '模板描述' })
    description?: string;

    @Column({ type: 'longtext', comment: '工作流数据（JSON格式）' })
    workflow_data!: string;

    @Column({ type: 'tinyint', default: 0, comment: '是否公开：0-私有，1-公开' })
    is_public!: number;

    @Column({ type: 'int', default: 0, comment: '使用次数' })
    usage_count!: number;

    @Column({ type: 'varchar', length: 500, nullable: true, comment: '封面图片URL' })
    cover_image?: string;

    @Column({ type: 'varchar', length: 50, nullable: true, comment: '分类标识' })
    @Index()
    category?: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
