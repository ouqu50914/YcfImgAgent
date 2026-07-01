import { AppDataSource } from "../data-source";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { User } from "../entities/User";

const EXPIRES_DAYS = 14;

function computeExpiresAt(isPublic: number, isFavorite: number): Date | null {
    if (isPublic === 1 || isFavorite === 1) return null;
    const d = new Date();
    d.setDate(d.getDate() + EXPIRES_DAYS);
    return d;
}

export class WorkflowService {
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);

    /**
     * 保存工作流模板
     * isTemp: 是否临时项目（例如从公开模板派生出来的个人草稿）
     * sourceTemplateId: 若为临时项目，则记录来源公开模板 ID
     */
    async saveTemplate(
        userId: number,
        name: string,
        workflowData: any,
        description?: string,
        isPublic: boolean = false,
        coverImage?: string,
        category?: string,
        isFavorite: boolean = false,
        isTemp: boolean = false,
        sourceTemplateId?: number
    ) {
        const template = new WorkflowTemplate();
        template.user_id = userId;
        template.name = name;
        if (description !== undefined) {
            template.description = description;
        }
        template.workflow_data = JSON.stringify(workflowData);
        template.is_public = isPublic ? 1 : 0;
        template.is_favorite = isFavorite ? 1 : 0;
        template.is_temp = isTemp ? 1 : 0;
        if (sourceTemplateId !== undefined) {
            template.source_template_id = sourceTemplateId;
        }
        template.usage_count = 0;
        if (coverImage !== undefined) {
            template.cover_image = coverImage;
        }
        if (category !== undefined) {
            template.category = category;
        }
        template.expires_at = computeExpiresAt(template.is_public, template.is_favorite) as any;

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

    /** 列表展示：不加载 workflow_data */
    async getUserTemplatesLite(userId: number) {
        return this.templateRepo
            .createQueryBuilder('template')
            .select([
                'template.id',
                'template.user_id',
                'template.name',
                'template.cover_image',
                'template.is_public',
                'template.is_favorite',
                'template.is_temp',
                'template.source_template_id',
                'template.category',
                'template.created_at',
                'template.updated_at',
            ])
            .where('template.user_id = :userId', { userId })
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
     * 删除模板（仅删库记录；uploads 文件由孤儿清理任务回收）
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

    /** 定时任务：删除已过期的未公开且未收藏模板（公开或收藏的永久保留） */
    async deleteExpiredTemplates() {
        const now = new Date();
        const list = await this.templateRepo
            .createQueryBuilder("t")
            .where("t.expires_at IS NOT NULL")
            .andWhere("t.expires_at <= :now", { now })
            .getMany();
        let deleted = 0;
        for (const row of list) {
            await this.templateRepo.remove(row);
            deleted++;
        }
        return deleted;
    }

    /**
     * 更新模板
     */
    async updateTemplate(templateId: number, userId: number, updates: {
        name?: string;
        description?: string;
        workflow_data?: any;
        is_public?: boolean;
        is_favorite?: boolean;
        cover_image?: string;
        category?: string;
        is_temp?: boolean;
        source_template_id?: number | null;
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
        if (updates.is_favorite !== undefined) template.is_favorite = updates.is_favorite ? 1 : 0;
        if (updates.cover_image !== undefined) template.cover_image = updates.cover_image;
        if (updates.category !== undefined) template.category = updates.category;
        if (updates.is_temp !== undefined) template.is_temp = updates.is_temp ? 1 : 0;
        if (updates.source_template_id !== undefined) template.source_template_id = updates.source_template_id ?? null;

        // 未公开且未收藏：每次更新滑动续期；公开或收藏永久保留
        template.expires_at = computeExpiresAt(template.is_public, template.is_favorite) as any;

        await this.templateRepo.save(template);
        return template;
    }

    /** 自动保存等只读操作时滑动续期（不修改 workflow_data） */
    async touchTemplateExpiresAt(templateId: number, userId: number) {
        const template = await this.templateRepo.findOne({
            where: { id: templateId, user_id: userId }
        });
        if (!template) return;
        template.expires_at = computeExpiresAt(template.is_public, template.is_favorite) as any;
        await this.templateRepo.save(template);
    }

    /**
     * 获取公开工作流模板列表（支持搜索和排序）
     */
    async getPublicTemplates(params: {
        keyword?: string;
        category?: string;
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

        // 分类筛选
        if (params.category) {
            query.andWhere('template.category = :category', { category: params.category });
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
