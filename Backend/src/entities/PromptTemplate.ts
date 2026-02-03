import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: 'prompt_template' })
export class PromptTemplate {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'bigint', comment: '关联用户ID' })
    user_id!: number;

    @Column({ length: 100, comment: '提示词名称' })
    name!: string;

    @Column({ type: 'text', comment: '提示词内容' })
    content!: string;

    @Column({ type: 'text', nullable: true, comment: '提示词描述' })
    description?: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
