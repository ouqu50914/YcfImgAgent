import { Request, Response } from "express";
import { GenerationSkillService } from "../services/generation-skill.service";
import { SkillApplyService } from "../services/skill-apply.service";
import { SkillRemoteImportService } from "../services/skill-remote-import.service";
import { assessGenerationSkillUsability } from "../utils/skill-generation-usability.util";
import type { SkillInput } from "../utils/skill-validation.util";
import type { GenerationSkillScope } from "../entities/GenerationSkill";

const skillService = new GenerationSkillService();
const skillApplyService = new SkillApplyService();
const skillRemoteImportService = new SkillRemoteImportService();

function parseScope(raw: unknown): GenerationSkillScope | undefined {
    if (raw === "image" || raw === "video" || raw === "both") return raw;
    return undefined;
}

export const createSkill = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { name, content, scope, description, format, apply_mode, metadata_json, source_path } = req.body;
        if (!name || !content) {
            return res.status(400).json({ message: "名称和内容不能为空" });
        }

        const skill = await skillService.createSkill(
            userId,
            name,
            content,
            parseScope(scope),
            description,
            format,
            apply_mode,
            metadata_json,
            source_path
        );
        return res.status(201).json({ message: "创建成功", data: skill });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const getUserSkills = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const scope = parseScope(req.query.scope);
        const skills = await skillService.getUserSkills(userId, scope);
        return res.status(200).json({ message: "获取成功", data: skills });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const getSkill = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const idParam = req.params.id;
        if (typeof idParam !== "string") return res.status(400).json({ message: "无效的ID" });
        const id = parseInt(idParam);
        if (isNaN(id)) return res.status(400).json({ message: "无效的ID" });

        const skill = await skillService.getSkillById(id, userId);
        if (!skill) return res.status(404).json({ message: "Skill 不存在" });

        return res.status(200).json({ message: "获取成功", data: skill });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const updateSkill = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const idParam = req.params.id;
        if (typeof idParam !== "string") return res.status(400).json({ message: "无效的ID" });
        const id = parseInt(idParam);
        if (isNaN(id)) return res.status(400).json({ message: "无效的ID" });

        const { name, content, scope, description, format, apply_mode, metadata_json, source_path } = req.body;
        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (content !== undefined) updates.content = content;
        const parsedScope = parseScope(scope);
        if (parsedScope !== undefined) updates.scope = parsedScope;
        if (description !== undefined) updates.description = description;
        if (format !== undefined) updates.format = format;
        if (apply_mode !== undefined) updates.apply_mode = apply_mode;
        if (metadata_json !== undefined) updates.metadata_json = metadata_json;
        if (source_path !== undefined) updates.source_path = source_path;

        const skill = await skillService.updateSkill(id, userId, updates as any);
        return res.status(200).json({ message: "更新成功", data: skill });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const deleteSkill = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const idParam = req.params.id;
        if (typeof idParam !== "string") return res.status(400).json({ message: "无效的ID" });
        const id = parseInt(idParam);
        if (isNaN(id)) return res.status(400).json({ message: "无效的ID" });

        await skillService.deleteSkill(id, userId);
        return res.status(200).json({ message: "删除成功" });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const searchSkills = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const keyword = req.query.keyword as string;
        if (!keyword) return res.status(400).json({ message: "搜索关键词不能为空" });

        const scope = parseScope(req.query.scope);
        const skills = await skillService.searchSkills(userId, keyword, scope);
        return res.status(200).json({ message: "搜索成功", data: skills });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const importSkills = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { skills } = req.body as { skills?: unknown };
        if (!Array.isArray(skills)) {
            return res.status(400).json({ message: "skills 必须是数组" });
        }

        const created = await skillService.importSkills(userId, skills as any[]);
        return res.status(201).json({
            message: `成功导入 ${created.length} 个 Skill`,
            data: created,
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const applySkillsToPrompt = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { skills, userPrompt, target } = req.body as {
            skills?: unknown;
            userPrompt?: string;
            target?: string;
        };

        if (!Array.isArray(skills) || skills.length === 0) {
            return res.status(400).json({ message: "skills 不能为空" });
        }

        const normalizedTarget = target === "video" ? "video" : "image";
        const result = await skillApplyService.applySkillsToPrompt({
            skills: skills as any[],
            userPrompt: typeof userPrompt === "string" ? userPrompt : "",
            target: normalizedTarget,
        });

        return res.status(200).json({
            message: "应用成功",
            data: result,
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const listSkillMarketplace = async (_req: Request, res: Response) => {
    try {
        const sources = skillRemoteImportService.listMarketplaceSources();
        return res.status(200).json({ message: "获取成功", data: sources });
    } catch (error: any) {
        return res.status(500).json({ message: error.message });
    }
};

export const listSkillMarketplaceItems = async (req: Request, res: Response) => {
    try {
        const sourceId = req.params.sourceId;
        if (typeof sourceId !== "string" || !sourceId) {
            return res.status(400).json({ message: "无效的技能源 ID" });
        }
        const items = await skillRemoteImportService.listMarketplaceItems(sourceId);
        return res.status(200).json({ message: "获取成功", data: items });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const previewRemoteSkills = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { url } = req.body as { url?: string };
        if (!url || typeof url !== "string") {
            return res.status(400).json({ message: "url 不能为空" });
        }

        const drafts = await skillRemoteImportService.previewRemote(url);
        return res.status(200).json({
            message: "解析成功",
            data: drafts,
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const importRemoteSkills = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { url } = req.body as { url?: string };
        if (!url || typeof url !== "string") {
            return res.status(400).json({ message: "url 不能为空" });
        }

        const drafts = await skillRemoteImportService.importRemote(url);
        const created = await skillService.importSkills(userId, drafts);
        return res.status(201).json({
            message: `成功从网络导入 ${created.length} 个 Skill`,
            data: created,
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};

export const checkSkillsUsability = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { skills } = req.body as { skills?: unknown };
        if (!Array.isArray(skills)) {
            return res.status(400).json({ message: "skills 必须是数组" });
        }

        const data = (skills as SkillInput[]).map((skill) => ({
            skill,
            usability: assessGenerationSkillUsability(skill),
        }));

        return res.status(200).json({ message: "检测完成", data });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
};
