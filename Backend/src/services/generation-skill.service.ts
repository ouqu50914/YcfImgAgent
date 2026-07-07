import { AppDataSource } from "../data-source";
import { GenerationSkill, type GenerationSkillScope } from "../entities/GenerationSkill";
import {
    SKILL_LIMITS,
    assignValidatedToEntity,
    validateSkillInput,
    type SkillInput,
} from "../utils/skill-validation.util";
import { assertSkillUsableForGeneration } from "../utils/skill-generation-usability.util";

export class GenerationSkillService {
    private skillRepo = AppDataSource.getRepository(GenerationSkill);

    private buildSkillFromValidated(userId: number, validated: ReturnType<typeof validateSkillInput>) {
        const skill = new GenerationSkill();
        skill.user_id = userId;
        assignValidatedToEntity(skill, validated);
        return skill;
    }

    async createSkill(
        userId: number,
        name: string,
        content: string,
        scope?: GenerationSkillScope,
        description?: string,
        format?: string,
        apply_mode?: string,
        metadata_json?: string,
        source_path?: string
    ) {
        const input: SkillInput = { name, content };
        if (scope !== undefined) input.scope = scope;
        if (description !== undefined) input.description = description;
        if (format !== undefined) input.format = format;
        if (apply_mode !== undefined) input.apply_mode = apply_mode;
        if (metadata_json !== undefined) input.metadata_json = metadata_json;
        if (source_path !== undefined) input.source_path = source_path;

        const validated = validateSkillInput(input);
        const skill = this.buildSkillFromValidated(userId, validated);
        await this.skillRepo.save(skill);
        return skill;
    }

    async importSkills(userId: number, items: SkillInput[]) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error("导入列表不能为空");
        }
        if (items.length > SKILL_LIMITS.IMPORT_BATCH_MAX) {
            throw new Error(`单次最多导入 ${SKILL_LIMITS.IMPORT_BATCH_MAX} 个 Skill`);
        }

        const created: GenerationSkill[] = [];
        for (let i = 0; i < items.length; i++) {
            const validated = validateSkillInput(items[i]!, i);
            assertSkillUsableForGeneration(validated, i);
            const skill = this.buildSkillFromValidated(userId, validated);
            await this.skillRepo.save(skill);
            created.push(skill);
        }
        return created;
    }

    async getUserSkills(userId: number, scope?: GenerationSkillScope) {
        const qb = this.skillRepo
            .createQueryBuilder("skill")
            .where("skill.user_id = :userId", { userId })
            .orderBy("skill.updated_at", "DESC");

        if (scope && scope !== "both") {
            qb.andWhere("(skill.scope = :scope OR skill.scope = 'both')", { scope });
        }

        return qb.getMany();
    }

    async getSkillById(id: number, userId: number) {
        return this.skillRepo.findOne({ where: { id, user_id: userId } });
    }

    async updateSkill(
        id: number,
        userId: number,
        updates: {
            name?: string;
            content?: string;
            scope?: GenerationSkillScope;
            description?: string;
            format?: string;
            apply_mode?: string;
            metadata_json?: string;
            source_path?: string;
        }
    ) {
        const skill = await this.skillRepo.findOne({ where: { id, user_id: userId } });
        if (!skill) throw new Error("Skill 不存在");

        const hasUpdates = Object.keys(updates).some((k) => (updates as Record<string, unknown>)[k] !== undefined);
        if (hasUpdates) {
            const input: SkillInput = {
                name: updates.name ?? skill.name,
                content: updates.content ?? skill.content,
                scope: updates.scope ?? skill.scope,
                format: updates.format ?? skill.format,
                apply_mode: updates.apply_mode ?? skill.apply_mode,
            };
            if (updates.description !== undefined) input.description = updates.description;
            else if (skill.description) input.description = skill.description;
            if (updates.metadata_json !== undefined) input.metadata_json = updates.metadata_json;
            else if (skill.metadata_json) input.metadata_json = skill.metadata_json;
            if (updates.source_path !== undefined) input.source_path = updates.source_path;
            else if (skill.source_path) input.source_path = skill.source_path;

            const validated = validateSkillInput(input);
            assignValidatedToEntity(skill, validated);
        }

        await this.skillRepo.save(skill);
        return skill;
    }

    async deleteSkill(id: number, userId: number) {
        const skill = await this.skillRepo.findOne({ where: { id, user_id: userId } });
        if (!skill) throw new Error("Skill 不存在");
        await this.skillRepo.remove(skill);
    }

    async searchSkills(userId: number, keyword: string, scope?: GenerationSkillScope) {
        const qb = this.skillRepo
            .createQueryBuilder("skill")
            .where("skill.user_id = :userId", { userId })
            .andWhere("(skill.name LIKE :keyword OR skill.content LIKE :keyword)", {
                keyword: `%${keyword}%`,
            })
            .orderBy("skill.updated_at", "DESC");

        if (scope && scope !== "both") {
            qb.andWhere("(skill.scope = :scope OR skill.scope = 'both')", { scope });
        }

        return qb.getMany();
    }
}
