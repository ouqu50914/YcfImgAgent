import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import {
    deleteSkill,
    downloadSkillPackage,
    getSkill,
    importPrivateSkill,
    listSkills,
    patchSkill,
    skillUpload,
} from "../controllers/skill.controller";

const router = Router();

router.use(authenticateToken);
router.get("/", listSkills);
router.post("/import", skillUpload, importPrivateSkill);
router.get("/:id", getSkill);
router.patch("/:id", patchSkill);
router.delete("/:id", deleteSkill);
router.get("/:id/package", downloadSkillPackage);

export default router;
