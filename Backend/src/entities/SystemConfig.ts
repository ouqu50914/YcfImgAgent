import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity({ name: "system_config" })
export class SystemConfig {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ length: 100, unique: true, comment: "配置键，例如 help_doc_url" })
    key!: string;

    @Column({ type: "text", comment: "配置值" })
    value!: string;

    @Column({ type: "varchar", length: 255, nullable: true, comment: "配置说明" })
    description!: string | null;

    @UpdateDateColumn()
    updated_at!: Date;
}
