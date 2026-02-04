import { AppDataSource } from "../data-source";
import { WorkflowCategory } from "../entities/WorkflowCategory";

export class CategoryService {
    private categoryRepo = AppDataSource.getRepository(WorkflowCategory);

    /**
     * 获取所有启用的分类
     */
    async getActiveCategories() {
        return this.categoryRepo.find({
            where: { status: 1 },
            order: { sort_order: 'ASC', id: 'ASC' }
        });
    }

    /**
     * 获取所有分类（包括禁用的）
     */
    async getAllCategories() {
        return this.categoryRepo.find({
            order: { sort_order: 'ASC', id: 'ASC' }
        });
    }

    /**
     * 根据ID获取分类
     */
    async getCategoryById(id: number) {
        const category = await this.categoryRepo.findOne({
            where: { id }
        });
        if (!category) {
            throw new Error('分类不存在');
        }
        return category;
    }

    /**
     * 根据code获取分类
     */
    async getCategoryByCode(code: string) {
        return this.categoryRepo.findOne({
            where: { code }
        });
    }

    /**
     * 创建分类
     */
    async createCategory(data: {
        name: string;
        code: string;
        description?: string;
        sort_order?: number;
        status?: number;
    }) {
        // 检查code是否已存在
        const existing = await this.getCategoryByCode(data.code);
        if (existing) {
            throw new Error('分类标识已存在');
        }

        const category = new WorkflowCategory();
        category.name = data.name;
        category.code = data.code;
        if (data.description !== undefined) {
            category.description = data.description;
        }
        category.sort_order = data.sort_order || 0;
        category.status = data.status !== undefined ? data.status : 1;

        await this.categoryRepo.save(category);
        return category;
    }

    /**
     * 更新分类
     */
    async updateCategory(id: number, data: {
        name?: string;
        code?: string;
        description?: string;
        sort_order?: number;
        status?: number;
    }) {
        const category = await this.getCategoryById(id);

        if (data.name !== undefined) category.name = data.name;
        if (data.code !== undefined) {
            // 检查code是否已被其他分类使用
            const existing = await this.getCategoryByCode(data.code);
            if (existing && existing.id !== id) {
                throw new Error('分类标识已被使用');
            }
            category.code = data.code;
        }
        if (data.description !== undefined) category.description = data.description;
        if (data.sort_order !== undefined) category.sort_order = data.sort_order;
        if (data.status !== undefined) category.status = data.status;

        await this.categoryRepo.save(category);
        return category;
    }

    /**
     * 删除分类
     */
    async deleteCategory(id: number) {
        const category = await this.getCategoryById(id);
        await this.categoryRepo.remove(category);
        return { message: '分类删除成功' };
    }
}
