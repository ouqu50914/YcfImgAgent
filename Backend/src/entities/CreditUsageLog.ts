import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity({ name: 'credit_usage_log' })
@Index(['user_id', 'created_at'])
@Index(['api_type', 'created_at'])
export class CreditUsageLog {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    @Index()
    user_id!: number;

    @Column({ type: 'int', comment: '消耗积分数量' })
    amount!: number;

    @Column({ length: 30, comment: '操作类型：generate/upscale/extend/split/layer_split' })
    operation_type!: string;

    @Column({ length: 20, comment: 'API类型：dream/nano' })
    api_type!: string;

    @CreateDateColumn()
    created_at!: Date;
}
