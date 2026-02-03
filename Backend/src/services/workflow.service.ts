import { AppDataSource } from "../data-source";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { User } from "../entities/User";

export class WorkflowService {
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);

    /**
     * 保存工作流模板
     */
    async saveTemplate(userId: number, name: string, workflowData: any, description?: string, isPublic: boolean = false, coverImage?: string) {
        const template = new WorkflowTemplate();
        template.user_id = userId;
        template.name = name;
        if (description !== undefined) {
            template.description = description;
        }
        template.workflow_data = JSON.stringify(workflowData);
        template.is_public = isPublic ? 1 : 0;
        template.usage_count = 0;
        if (coverImage !== undefined) {
            template.cover_image = coverImage;
        }

        await this.templateRepo.save(template);
        return template;
    }

    /**
     * 获取用户的工作流模板列表
     */
    async getUserTemplates(userId: number, includePublic: boolean = true) {
        const query = this.templateRepo.createQueryBuilder('template')
            .where('template.user_id = :userId', { userId });

        if (includePublic) {
            query.orWhere('template.is_public = 1');
        }

        return query
            .orderBy('template.updated_at', 'DESC')
            .getMany();
    }

    /**
     * 获取模板详情
     */
    async getTemplate(templateId: number, userId?: number) {
        const template = await this.templateRepo.findOne({
            where: { id: templateId }
        });

        if (!template) {
            throw new Error('模板不存在');
        }

        // 检查权限：私有模板只能创建者访问
        if (template.is_public === 0 && template.user_id !== userId) {
            throw new Error('无权访问此模板');
        }

        // 增加使用次数
        template.usage_count += 1;
        await this.templateRepo.save(template);

        return {
            ...template,
            workflow_data: JSON.parse(template.workflow_data)
        };
    }

    /**
     * 删除模板
     */
    async deleteTemplate(templateId: number, userId: number) {
        const template = await this.templateRepo.findOne({
            where: { id: templateId, user_id: userId }
        });

        if (!template) {
            throw new Error('模板不存在或无权限删除');
        }

        await this.templateRepo.remove(template);
        return { message: '模板删除成功' };
    }

    /**
     * 更新模板
     */
    async updateTemplate(templateId: number, userId: number, updates: {
        name?: string;
        description?: string;
        workflow_data?: any;
        is_public?: boolean;
    }) {
        const template = await this.templateRepo.findOne({
            where: { id: templateId, user_id: userId }
        });

        if (!template) {
            throw new Error('模板不存在或无权限修改');
        }

        if (updates.name) template.name = updates.name;
        if (updates.description !== undefined) template.description = updates.description;
        if (updates.workflow_data) template.workflow_data = JSON.stringify(updates.workflow_data);
        if (updates.is_public !== undefined) template.is_public = updates.is_public ? 1 : 0;

        await this.templateRepo.save(template);
        return template;
    }

    /**
     * 获取公开工作流模板列表（支持搜索和排序）
     */
    async getPublicTemplates(params: {
        keyword?: string;
        sortBy?: 'time' | 'usage';
        page?: number;
        pageSize?: number;
    }) {
        const query = this.templateRepo.createQueryBuilder('template')
            .leftJoin('sys_user', 'user', 'user.id = template.user_id')
            .where('template.is_public = 1');

        // 关键词搜索（模糊搜索：名称和作者）
        if (params.keyword) {
            query.andWhere(
                '(template.name LIKE :keyword OR user.username LIKE :keyword)',
                { keyword: `%${params.keyword}%` }
            );
        }

        // 排序
        if (params.sortBy === 'usage') {
            query.orderBy('template.usage_count', 'DESC');
        } else {
            query.orderBy('template.created_at', 'DESC');
        }

        // 分页
        const page = params.page || 1;
        const pageSize = params.pageSize || 12;
        query.skip((page - 1) * pageSize).take(pageSize);

        const [list, total] = await query.getManyAndCount();

        // 获取作者名称
        const userRepo = AppDataSource.getRepository(User);
        
        const templates = await Promise.all(list.map(async (template: any) => {
            const user = await userRepo.findOne({
                where: { id: template.user_id },
                select: ['username']
            });
            return {
                ...template,
                author_name: user?.username || '未知'
            };
        }));

        return {
            list: templates,
            total
        };
    }
}
