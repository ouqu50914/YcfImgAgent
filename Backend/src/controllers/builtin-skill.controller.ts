import { Request, Response } from "express";
import { BuiltinSkillService } from "../services/builtin-skill.service";

const builtinSkillService = new BuiltinSkillService();

export const listBuiltinSkills = async (_req: Request, res: Response) => {
    try {
        const skills = builtinSkillService.listBuiltinSkills();
        return res.status(200).json({ message: "获取成功", data: skills });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const installBuiltinSkill = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const slug = req.params.slug;
        if (typeof slug !== "string" || !slug) {
            return res.status(400).json({ message: "无效的 Skill slug" });
        }

        const skill = await builtinSkillService.installBuiltinSkill(userId, slug);
        return res.status(201).json({ message: "已添加到 Skill 库", data: skill });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};
