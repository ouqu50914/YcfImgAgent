import { AppDataSource } from "../data-source";
import { PromptTemplate } from "../entities/PromptTemplate";

export class PromptTemplateService {
    private templateRepo = AppDataSource.getRepository(PromptTemplate);

    /**
     * 创建提示词模板
     */
    async createTemplate(userId: number, name: string, content: string, description?: string) {
        const template = new PromptTemplate();
        template.user_id = userId;
        template.name = name;
        template.content = content;
        if (description) {
            template.description = description;
        }

        await this.templateRepo.save(template);
        return template;
    }

    /**
     * 获取用户的所有提示词模板
     */
    async getUserTemplates(userId: number) {
        return await this.templateRepo.find({
            where: { user_id: userId },
            order: { created_at: 'DESC' }
        });
    }

    /**
     * 根据ID获取提示词模板
     */
    async getTemplateById(id: number, userId: number) {
        return await this.templateRepo.findOne({
            where: { id, user_id: userId }
        });
    }

    /**
     * 更新提示词模板
     */
    async updateTemplate(id: number, userId: number, updates: { name?: string; content?: string; description?: string }) {
        const template = await this.templateRepo.findOne({
            where: { id, user_id: userId }
        });

        if (!template) {
            throw new Error("提示词模板不存在");
        }

        if (updates.name !== undefined) {
            template.name = updates.name;
        }
        if (updates.content !== undefined) {
            template.content = updates.content;
        }
        if (updates.description !== undefined) {
            template.description = updates.description;
        }

        await this.templateRepo.save(template);
        return template;
    }

    /**
     * 删除提示词模板
     */
    async deleteTemplate(id: number, userId: number) {
        const template = await this.templateRepo.findOne({
            where: { id, user_id: userId }
        });

        if (!template) {
            throw new Error("提示词模板不存在");
        }

        await this.templateRepo.remove(template);
    }

    /**
     * 搜索提示词模板（按名称或内容）
     */
    async searchTemplates(userId: number, keyword: string) {
        return await this.templateRepo
            .createQueryBuilder('template')
            .where('template.user_id = :userId', { userId })
            .andWhere('(template.name LIKE :keyword OR template.content LIKE :keyword)', {
                keyword: `%${keyword}%`
            })
            .orderBy('template.created_at', 'DESC')
            .getMany();
    }
}
