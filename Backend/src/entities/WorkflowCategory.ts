import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: 'workflow_category' })
export class WorkflowCategory {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ length: 50, unique: true, comment: '分类名称' })
    name!: string;

    @Column({ length: 20, unique: true, comment: '分类标识（英文）' })
    code!: string;

    @Column({ type: 'text', nullable: true, comment: '分类描述' })
    description?: string;

    @Column({ type: 'int', default: 0, comment: '排序顺序' })
    sort_order!: number;

    @Column({ type: 'tinyint', default: 1, comment: '状态：0-禁用，1-启用' })
    status!: number;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
