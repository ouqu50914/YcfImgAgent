import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from "typeorm";

@Entity({ name: 'user_daily_quota' })
@Unique(['user_id', 'api_type', 'date'])
@Index(['user_id', 'date'])
export class UserDailyQuota {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    @Index()
    user_id!: number;

    @Column({ length: 20, comment: 'API类型：dream/nano' })
    api_type!: string;

    @Column({ type: 'date', comment: '日期（YYYY-MM-DD）' })
    date!: Date;

    @Column({ type: 'int', default: 0, comment: '已用额度' })
    used_quota!: number;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
