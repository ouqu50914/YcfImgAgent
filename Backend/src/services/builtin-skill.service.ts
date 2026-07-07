import {
    BUILTIN_GENERATION_SKILLS,
    getBuiltinSkillBySlug,
    builtinToSkillInput,
    type BuiltinGenerationSkill,
} from "../data/builtin-generation-skills";
import { GenerationSkillService } from "./generation-skill.service";

export class BuiltinSkillService {
    private skillService = new GenerationSkillService();

    listBuiltinSkills(): BuiltinGenerationSkill[] {
        return BUILTIN_GENERATION_SKILLS;
    }

    getBuiltinSkill(slug: string): BuiltinGenerationSkill | undefined {
        return getBuiltinSkillBySlug(slug);
    }

    /** 将内置 Skill 复制到用户库（已存在同 slug 则跳过） */
    async installBuiltinSkill(userId: number, slug: string) {
        const builtin = getBuiltinSkillBySlug(slug);
        if (!builtin) throw new Error("内置 Skill 不存在");

        const existing = await this.findUserSkillByBuiltinSlug(userId, slug);
        if (existing) return existing;

        const input = builtinToSkillInput(builtin);
        return this.skillService.createSkill(
            userId,
            input.name,
            input.content,
            input.scope,
            input.description,
            input.format,
            input.apply_mode,
            input.metadata_json,
            input.source_path
        );
    }

    private async findUserSkillByBuiltinSlug(userId: number, slug: string) {
        const skills = await this.skillService.getUserSkills(userId);
        for (const s of skills) {
            if (s.source_path === `builtin://${slug}`) return s;
            if (s.metadata_json) {
                try {
                    const meta = JSON.parse(s.metadata_json) as {
                        agent_skill?: { slug?: string; builtin?: boolean };
                    };
                    if (meta.agent_skill?.slug === slug && meta.agent_skill?.builtin) return s;
                } catch {
                    // ignore
                }
            }
        }
        return null;
    }
}
