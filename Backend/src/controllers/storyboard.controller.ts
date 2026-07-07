import { Request, Response } from "express";
import { StoryboardService } from "../services/storyboard.service";
import type { SkillApplyItem } from "../services/skill-apply.service";

const storyboardService = new StoryboardService();

export const generateStoryboard = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: "未登录" });

        const { script, skills, maxShots, aspectRatio, template, phase, shots } = req.body as {
            script?: string;
            skills?: unknown;
            maxShots?: number;
            aspectRatio?: string;
            template?: string;
            phase?: string;
            shots?: unknown;
        };

        if (!script || typeof script !== "string") {
            return res.status(400).json({ message: "script 不能为空" });
        }

        const input: {
            script: string;
            skills: SkillApplyItem[];
            maxShots?: number;
            aspectRatio?: string;
            template?: "default" | "four_panel_comic";
            phase?: "split" | "prompts" | "full";
            shots?: import("../services/storyboard.service").StoryboardShot[];
        } = {
            script,
            skills: Array.isArray(skills) ? (skills as SkillApplyItem[]) : [],
        };
        if (typeof maxShots === "number") input.maxShots = maxShots;
        if (typeof aspectRatio === "string") input.aspectRatio = aspectRatio;
        if (template === "four_panel_comic") input.template = "four_panel_comic";
        if (phase === "split" || phase === "prompts" || phase === "full") input.phase = phase;
        if (Array.isArray(shots)) input.shots = shots as import("../services/storyboard.service").StoryboardShot[];

        const result = await storyboardService.generateStoryboard(input);

        return res.status(200).json({
            message: "分镜生成成功",
            data: result,
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message || "分镜生成失败" });
    }
};
