import { Router } from "express";
import { optimizePrompt } from "../controllers/prompt.controller";
import {
    createTemplate,
    getUserTemplates,
    getTemplate,
    updateTemplate,
    deleteTemplate,
    searchTemplates
} from "../controllers/prompt-template.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

// 提示词优化接口（需要登录）
router.post("/optimize", authenticateToken, optimizePrompt);

// 提示词模板接口（需要登录）
router.post("/templates", authenticateToken, createTemplate);
router.get("/templates", authenticateToken, getUserTemplates);
router.get("/templates/search", authenticateToken, searchTemplates);
router.get("/templates/:id", authenticateToken, getTemplate);
router.put("/templates/:id", authenticateToken, updateTemplate);
router.delete("/templates/:id", authenticateToken, deleteTemplate);

export default router;
