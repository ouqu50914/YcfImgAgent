import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: 'sys_user' })
export class User {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ length: 50, unique: true, comment: '内网账号' })
    username!: string;

    @Column({ length: 100, select: false, comment: 'bcrypt加密密码' })
    // select: false 表示查询用户时默认不返回密码，更安全
    password!: string;

    @Column({ type: 'tinyint', default: 2, comment: '1-超管, 2-普通' })
    role_id!: number;

    @Column({ type: 'tinyint', default: 1, comment: '1-启用, 0-禁用' })
    status!: number;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}