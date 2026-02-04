import { Request, Response } from "express";
import { CategoryService } from "../services/category.service";

const categoryService = new CategoryService();

/**
 * 获取所有启用的分类（公开接口）
 */
export const getActiveCategories = async (req: Request, res: Response) => {
    try {
        const categories = await categoryService.getActiveCategories();
        return res.status(200).json({
            message: "获取成功",
            data: categories
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 获取所有分类（管理员接口）
 */
export const getAllCategories = async (req: Request, res: Response) => {
    try {
        const categories = await categoryService.getAllCategories();
        return res.status(200).json({
            message: "获取成功",
            data: categories
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

/**
 * 创建分类（管理员接口）
 */
export const createCategory = async (req: Request, res: Response) => {
    try {
        const { name, code, description, sort_order, status } = req.body;

        if (!name || !code) {
            return res.status(400).json({ message: "分类名称和标识不能为空" });
        }

        const category = await categoryService.createCategory({
            name,
            code,
            description,
            sort_order,
            status
        });

        return res.status(201).json({
            message: "创建成功",
            data: category
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 更新分类（管理员接口）
 */
export const updateCategory = async (req: Request, res: Response) => {
    try {
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的分类ID" });
        }
        const id = parseInt(idParam);
        if (isNaN(id)) {
            return res.status(400).json({ message: "无效的分类ID" });
        }

        const { name, code, description, sort_order, status } = req.body;

        const category = await categoryService.updateCategory(id, {
            name,
            code,
            description,
            sort_order,
            status
        });

        return res.status(200).json({
            message: "更新成功",
            data: category
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * 删除分类（管理员接口）
 */
export const deleteCategory = async (req: Request, res: Response) => {
    try {
        const idParam = req.params.id;
        if (!idParam || Array.isArray(idParam)) {
            return res.status(400).json({ message: "无效的分类ID" });
        }
        const id = parseInt(idParam);
        if (isNaN(id)) {
            return res.status(400).json({ message: "无效的分类ID" });
        }

        await categoryService.deleteCategory(id);
        return res.status(200).json({ message: "删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};
