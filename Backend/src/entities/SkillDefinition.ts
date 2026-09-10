import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

export type SkillVisibility = "draft" | "global" | "private" | "disabled";
export type SkillStatus = "active" | "unsupported";

@Entity({ name: "skill_definition" })
export class SkillDefinition {
    @PrimaryGeneratedColumn()
    id!: number;

    @Index()
    @Column({ type: "bigint", comment: "归属用户：private 必填；global/draft 为上传超管" })
    owner_user_id!: number;

    @Column({ length: 64, comment: "Skill name" })
    name!: string;

    @Column({ type: "varchar", length: 1024, comment: "描述" })
    description!: string;

    @Column({ type: "mediumtext", comment: "SKILL.md 正文" })
    body_md!: string;

    @Column({ type: "mediumtext", nullable: true, comment: "LLM 改造后的 ARTN 适配版正文" })
    adapted_body_md?: string | null;

    @Column({ type: "varchar", length: 8, nullable: true, comment: "适配评级 A|B|C" })
    compat_grade?: string | null;

    @Column({ type: "json", nullable: true, comment: "适配体检与 gaps 报告" })
    compat_report_json?: Record<string, unknown> | null;

    @Column({ type: "datetime", nullable: true, comment: "最近一次 LLM 适配时间" })
    adapted_at?: Date | null;

    @Column({ type: "json", nullable: true, comment: "frontmatter 原文结构" })
    frontmatter_json?: Record<string, unknown> | null;

    @Column({ type: "varchar", length: 512, nullable: true, comment: "原包逻辑路径 /uploads/skills/..." })
    package_key?: string | null;

    @Column({ type: "json", nullable: true, comment: "附件逻辑路径列表" })
    assets_json?: string[] | null;

    @Index()
    @Column({ type: "varchar", length: 16, default: "private", comment: "draft|global|private|disabled" })
    visibility!: SkillVisibility;

    @Column({ type: "varchar", length: 16, default: "active", comment: "active|unsupported" })
    status!: SkillStatus;

    @Column({ type: "json", nullable: true, comment: "兼容标记如 has_scripts" })
    compat_flags?: Record<string, unknown> | null;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}
