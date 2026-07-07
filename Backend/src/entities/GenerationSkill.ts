import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type GenerationSkillScope = "image" | "video" | "both";
export type GenerationSkillFormat = "plain" | "agent_skill" | "cursor_skill";
export type GenerationSkillApplyMode = "merge" | "preprocess";

@Entity({ name: "generation_skill" })
export class GenerationSkill {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: "bigint", comment: "关联用户ID" })
    user_id!: number;

    @Column({ length: 100, comment: "Skill 名称" })
    name!: string;

    @Column({ type: "text", comment: "Skill 指令内容（风格/角色/约束等）" })
    content!: string;

    @Column({
        type: "varchar",
        length: 16,
        default: "both",
        comment: "适用范围：image / video / both",
    })
    scope!: GenerationSkillScope;

    @Column({ type: "text", nullable: true, comment: "Skill 描述" })
    description?: string;

    @Column({
        type: "varchar",
        length: 20,
        default: "plain",
        comment: "格式：plain 纯文本 / agent_skill Agent Skills 标准 SKILL.md",
    })
    format!: GenerationSkillFormat;

    @Column({
        type: "varchar",
        length: 20,
        default: "merge",
        comment: "应用方式：merge 直接合并 / preprocess Gemini 预处理",
    })
    apply_mode!: GenerationSkillApplyMode;

    @Column({ type: "text", nullable: true, comment: "扩展元数据 JSON（Cursor frontmatter、参考文件摘要等）" })
    metadata_json?: string;

    @Column({ type: "varchar", length: 500, nullable: true, comment: "导入来源路径" })
    source_path?: string;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
