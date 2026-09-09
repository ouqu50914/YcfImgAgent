import { Request, Response } from "express";
import multer from "multer";
import { SkillService } from "../services/skill.service";
import { SkillVisibility } from "../entities/SkillDefinition";

const skillService = new SkillService();

export const skillUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

function userIdOf(req: Request): number {
    return Number((req as any).user?.userId || (req as any).user?.id);
}

export const listSkills = async (req: Request, res: Response) => {
    try {
        const data = await skillService.listForUser(userIdOf(req));
        return res.status(200).json({ message: "ok", data: { skills: data } });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "列表失败" });
    }
};

export const getSkill = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const row = await skillService.getForUser(userIdOf(req), id);
        return res.status(200).json({
            message: "ok",
            data: {
                id: row.id,
                name: row.name,
                description: row.description,
                body_md: skillService.truncateBody(row.body_md),
                visibility: row.visibility,
                status: row.status,
                compat_flags: row.compat_flags,
            },
        });
    } catch (e: any) {
        const code = String(e.message || "").includes("无权") ? 403 : 400;
        return res.status(code).json({ message: e.message || "获取失败" });
    }
};

export const importPrivateSkill = async (req: Request, res: Response) => {
    try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) return res.status(400).json({ message: "请上传 file（zip 或 SKILL.md）" });
        const row = await skillService.importSkill({
            userId: userIdOf(req),
            mode: "private",
            fileName: file.originalname || "skill.zip",
            buffer: file.buffer,
        });
        return res.status(200).json({
            message: "导入成功（仅自己可见）",
            data: {
                id: row.id,
                name: row.name,
                visibility: row.visibility,
                status: row.status,
                compat_flags: row.compat_flags,
            },
        });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "导入失败" });
    }
};

export const patchSkill = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { name, description, visibility } = req.body || {};
        const row = await skillService.patchPrivate(userIdOf(req), id, { name, description, visibility });
        return res.status(200).json({ message: "已更新", data: { id: row.id, visibility: row.visibility } });
    } catch (e: any) {
        const code = String(e.message || "").includes("无权") || String(e.message || "").includes("不能") ? 403 : 400;
        return res.status(code).json({ message: e.message || "更新失败" });
    }
};

export const deleteSkill = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        await skillService.deleteOwned(userIdOf(req), id, false);
        return res.status(200).json({ message: "已删除" });
    } catch (e: any) {
        const code = String(e.message || "").includes("无权") ? 403 : 400;
        return res.status(code).json({ message: e.message || "删除失败" });
    }
};

export const downloadSkillPackage = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { buffer, fileName } = await skillService.downloadPackage(userIdOf(req), id, false);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
        return res.send(buffer);
    } catch (e: any) {
        const code = String(e.message || "").includes("无权") ? 403 : 400;
        return res.status(code).json({ message: e.message || "下载失败" });
    }
};

/** Admin handlers */
export const adminListSkills = async (_req: Request, res: Response) => {
    try {
        const data = await skillService.listForAdmin();
        return res.status(200).json({ message: "ok", data: { skills: data } });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "列表失败" });
    }
};

export const adminImportSkill = async (req: Request, res: Response) => {
    try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) return res.status(400).json({ message: "请上传 file" });
        const row = await skillService.importSkill({
            userId: userIdOf(req),
            mode: "admin_global",
            fileName: file.originalname || "skill.zip",
            buffer: file.buffer,
        });
        return res.status(200).json({
            message: "已导入为 draft，请设为通用后全员可见",
            data: {
                id: row.id,
                name: row.name,
                visibility: row.visibility,
                status: row.status,
                compat_flags: row.compat_flags,
            },
        });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "导入失败" });
    }
};

export const adminSetSkillVisibility = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const visibility = String(req.body?.visibility || "") as SkillVisibility;
        if (!["draft", "global", "disabled"].includes(visibility)) {
            return res.status(400).json({ message: "visibility 须为 draft|global|disabled" });
        }
        const row = await skillService.adminSetVisibility(id, visibility);
        return res.status(200).json({ message: "已更新", data: { id: row.id, visibility: row.visibility } });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "更新失败" });
    }
};

export const adminDeleteSkill = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        await skillService.deleteOwned(userIdOf(req), id, true);
        return res.status(200).json({ message: "已删除" });
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "删除失败" });
    }
};

export const adminDownloadSkillPackage = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const { buffer, fileName } = await skillService.downloadPackage(userIdOf(req), id, true);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
        return res.send(buffer);
    } catch (e: any) {
        return res.status(400).json({ message: e.message || "下载失败" });
    }
};
