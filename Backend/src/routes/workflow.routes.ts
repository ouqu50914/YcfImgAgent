import { Router } from "express";
import { 
    saveTemplate, getTemplates, getTemplate, deleteTemplate, updateTemplate,
    autoSaveHistory, getHistoryList, getHistory, deleteHistory, getPublicTemplates
} from "../controllers/workflow.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { getActiveCategories } from "../controllers/category.controller";

const router = Router();

// 公开接口：获取分类列表（不需要登录）
router.get("/categories", getActiveCategories);

// 所有路由都需要登录
router.use(authenticateToken);

// 模板相关
router.post("/template", saveTemplate);
router.get("/templates", getTemplates);
router.get("/templates/public", getPublicTemplates); // 公开工作流列表（工作流广场）
router.get("/template/:id", getTemplate);
router.put("/template/:id", updateTemplate);
router.delete("/template/:id", deleteTemplate);

// 历史记录相关
router.post("/history/auto-save", autoSaveHistory);
router.get("/history", getHistoryList);
router.get("/history/:id", getHistory);
router.delete("/history/:id", deleteHistory);

export default router;
