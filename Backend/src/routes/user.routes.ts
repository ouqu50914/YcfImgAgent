import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { createCreditApplication, getHelpDocUrlForClient } from "../controllers/user.controller";

const router = Router();

router.use(authenticateToken);

// 提交积分申请
router.post("/credit-application", createCreditApplication);

// 获取操作手册链接（任意登录用户可访问）
router.get("/config/help-doc-url", getHelpDocUrlForClient);

export default router;
