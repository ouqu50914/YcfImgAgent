import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity({ name: 'api_config' })
export class ApiConfig {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ length: 20, unique: true, comment: 'dream/nano' })
    api_type!: string;

    @Column({ length: 255 })
    api_url!: string;

    @Column({ length: 100, select: false })
    api_key!: string;

    @Column({ type: 'tinyint', default: 1 })
    status!: number;

    @Column({ type: 'int', default: 100, comment: '单人每日限额' })
    user_daily_limit!: number;

    @Column({ type: 'int', default: 0, comment: '已用总额度' })
    used_quota!: number;

    @UpdateDateColumn()
    last_sync_time!: Date;
}