import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity({ name: 'operation_log' })
@Index(['user_id', 'created_at'])
@Index(['api_type', 'created_at'])
export class OperationLog {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    @Index()
    user_id!: number;

    @Column({ length: 50, comment: '操作类型：login, generate, upscale, extend, optimize等' })
    operation_type!: string;

    @Column({ length: 20, nullable: true, comment: 'API类型：dream/nano' })
    api_type?: string;

    @Column({ type: 'text', nullable: true, comment: '操作详情（JSON格式）' })
    details?: string;

    @Column({ length: 45, nullable: true, comment: 'IP地址' })
    ip_address?: string;

    @Column({ length: 255, nullable: true, comment: '用户代理' })
    user_agent?: string;

    @CreateDateColumn()
    created_at!: Date;
}
