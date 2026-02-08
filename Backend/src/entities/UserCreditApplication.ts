import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: 'user_credit_application' })
export class UserCreditApplication {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '用户ID' })
    user_id!: number;

    @Column({ type: 'int', comment: '申请积分数量' })
    amount!: number;

    @Column({ type: 'varchar', length: 500, nullable: true, comment: '申请原因' })
    reason!: string | null;

    @Column({ type: 'varchar', length: 20, default: 'pending', comment: '状态：pending/approved/rejected' })
    status!: string;

    @Column({ type: 'bigint', nullable: true, comment: '审批管理员ID' })
    admin_id!: number | null;

    @Column({ type: 'varchar', length: 500, nullable: true, comment: '管理员备注' })
    admin_comment!: string | null;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
