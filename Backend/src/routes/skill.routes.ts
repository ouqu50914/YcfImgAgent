import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import {
    adaptSkill,
    deleteSkill,
    downloadSkillPackage,
    getSkill,
    getSkillAsset,
    importPrivateSkill,
    listSkillAssets,
    listSkills,
    patchSkill,
    reassessSkillCompat,
    skillUpload,
} from "../controllers/skill.controller";

const router = Router();

router.use(authenticateToken);
router.get("/", listSkills);
router.post("/import", skillUpload, importPrivateSkill);
router.get("/:id", getSkill);
router.get("/:id/assets", listSkillAssets);
router.get("/:id/asset", getSkillAsset);
router.post("/:id/compat/reassess", reassessSkillCompat);
router.post("/:id/adapt", adaptSkill);
router.patch("/:id", patchSkill);
router.delete("/:id", deleteSkill);
router.get("/:id/package", downloadSkillPackage);

export default router;
