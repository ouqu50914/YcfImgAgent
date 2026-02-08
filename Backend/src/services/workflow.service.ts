import path from "path";
import fs from "fs";
import { AppDataSource } from "../data-source";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { User } from "../entities/User";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const EXPIRES_DAYS = 14;

/** 从 workflow_data 和 cover_image 中收集 /uploads/ 下的文件名（含所有节点类型中的图片引用） */
function collectUploadFilenames(workflowData: any, coverImage?: string | null): string[] {
    const names: string[] = [];
    const add = (url: string | undefined | null) => {
        if (!url || typeof url !== "string") return;
        const m = url.match(/\/uploads\/([^/?]+)/);
        if (m && m[1]) names.push(m[1]);
    };
    add(coverImage);
    if (workflowData && typeof workflowData === "object") {
        const nodes = workflowData.nodes || [];
        for (const node of nodes) {
            const d = node?.data;
            if (!d) continue;
            add(d.imageUrl);
            add(d.originalImageUrl);
            add(d.image_url);
            if (Array.isArray(d.imageUrls)) for (const u of d.imageUrls) add(u);
            const lr = d.layerResult;
            if (lr?.layers && Array.isArray(lr.layers)) {
                for (const layer of lr.layers) add(layer?.url);
            }
        }
        add(workflowData.cover_image);
    }
    return [...new Set(names)];
}

export class WorkflowService {
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);

    /**
     * 保存工作流模板
     */
    async saveTemplate(userId: number, name: string, workflowData: any, description?: string, isPublic: boolean = false, coverImage?: string, category?: string, isFavorite: boolean = false) {
        const template = new WorkflowTemplate();
        template.user_id = userId;
        template.name = name;
        if (description !== undefined) {
            template.description = description;
        }
        template.workflow_data = JSON.stringify(workflowData);
        template.is_public = isPublic ? 1 : 0;
        template.is_favorite = isFavorite ? 1 : 0;
        template.usage_count = 0;
        if (coverImage !== undefined) {
            template.cover_image = coverImage;
        }
        if (category !== undefined) {
            template.category = category;
        }
        // 未公开且未收藏的项目：14天后自动删除；公开或收藏的永久保留
        if (template.is_public === 0 && template.is_favorite === 0) {
            const d = new Date();
            d.setDate(d.getDate() + EXPIRES_DAYS);
            template.expires_at = d;
        } else {
            template.expires_at = null as any;
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
     * 删除模板并删除关联的上传图片文件
     */
    async deleteTemplate(templateId: number, userId: number) {
        const template = await this.templateRepo.findOne({
            where: { id: templateId, user_id: userId }
        });

        if (!template) {
            throw new Error('模板不存在或无权限删除');
        }

        await this.deleteTemplateFiles(template);
        await this.templateRepo.remove(template);
        return { message: '模板删除成功' };
    }

    /** 删除模板关联的 uploads 文件（不删库记录） */
    private async deleteTemplateFiles(template: WorkflowTemplate) {
        let data: any;
        try {
            data = JSON.parse(template.workflow_data);
        } catch {
            data = null;
        }
        const filenames = collectUploadFilenames(data, template.cover_image);
        for (const name of filenames) {
            const filePath = path.join(UPLOADS_DIR, name);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                console.warn("deleteTemplateFiles unlink failed:", filePath, e);
            }
        }
    }

    /** 定时任务：删除已过期的未公开且未收藏模板及其图片（公开或收藏的永久保留） */
    async deleteExpiredTemplates() {
        const now = new Date();
        const list = await this.templateRepo
            .createQueryBuilder("t")
            .where("t.expires_at IS NOT NULL")
            .andWhere("t.expires_at <= :now", { now })
            .getMany();
        let deleted = 0;
        for (const row of list) {
            await this.deleteTemplateFiles(row);
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

        // 未公开且未收藏的项目：14天后自动删除；公开或收藏的永久保留
        if (template.is_public === 0 && template.is_favorite === 0) {
            // 如果之前没有 expires_at，设置新的过期时间
            if (!template.expires_at) {
                const d = new Date();
                d.setDate(d.getDate() + EXPIRES_DAYS);
                template.expires_at = d;
            }
        } else {
            // 公开或收藏：清除过期时间，永久保留
            template.expires_at = null as any;
        }

        await this.templateRepo.save(template);
        return template;
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
