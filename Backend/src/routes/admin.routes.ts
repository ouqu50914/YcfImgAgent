import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/admin.middleware";
import {
    getUserList,
    createUser,
    updateUser,
    resetPassword,
    deleteUser,
    getOperationLogs,
    getApiConfigs,
    updateApiConfig,
    getUserStats,
    getCreditApplications,
    getPendingCreditApplicationCount,
    approveCreditApplication,
    rejectCreditApplication,
    updateUserCredits,
    getHelpDocUrl,
    updateHelpDocUrl,
    getGenerationRecords
} from "../controllers/admin.controller";
import {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
} from "../controllers/category.controller";

const router = Router();

router.use(authenticateToken);
// 生成记录：已登录即可（普通用户仅本人数据由服务层强制）
router.get("/generation-records", getGenerationRecords);

// 以下需超级管理员
router.use(requireAdmin);

// 用户管理
router.get("/users", getUserList);
router.post("/users", createUser);
router.get("/users/:id/stats", getUserStats);
router.put("/users/:id", updateUser);
router.put("/users/:id/credits", updateUserCredits);
router.post("/users/:id/reset-password", resetPassword);
router.delete("/users/:id", deleteUser);

// 积分申请管理
router.get("/credit-applications/pending-count", getPendingCreditApplicationCount);
router.get("/credit-applications", getCreditApplications);
router.post("/credit-applications/:id/approve", approveCreditApplication);
router.post("/credit-applications/:id/reject", rejectCreditApplication);

// 日志查看
router.get("/logs", getOperationLogs);

// API配置管理
router.get("/api-configs", getApiConfigs);
router.put("/api-configs/:apiType", updateApiConfig);

// 系统配置 - 操作手册链接
router.get("/config/help-doc-url", getHelpDocUrl);
router.put("/config/help-doc-url", updateHelpDocUrl);

// 分类管理
router.get("/categories", getAllCategories);
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

export default router;
