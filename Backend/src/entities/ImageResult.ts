import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity({ name: 'image_result' })
export class ImageResult {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id!: number;

    @Column({ type: 'bigint', comment: '关联用户ID' })
    user_id!: number;

    @Column({ length: 20 })
    api_type!: string;

    @Column({ type: 'text', nullable: true })
    prompt!: string;

    @Column({
        type: 'varchar',
        length: 64,
        nullable: true,
        comment: '前端生成时传入的幂等 key，用于刷新/历史恢复后查询生成结果'
    })
    generation_key!: string;

    @Column({ length: 255, nullable: true, comment: '图片存储路径' })
    image_url!: string;

    @Column({ type: 'longtext', nullable: true, comment: '多图生成结果（JSON 数组）' })
    all_images!: string;

    @Column({ type: 'tinyint', default: 1, comment: '1-成功, 0-失败' })
    status!: number;

    @CreateDateColumn()
    created_at!: Date;
}