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
    getUserStats
} from "../controllers/admin.controller";
import {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
} from "../controllers/category.controller";

const router = Router();

// 所有管理员路由都需要登录且为超级管理员
router.use(authenticateToken);
router.use(requireAdmin);

// 用户管理
router.get("/users", getUserList);
router.post("/users", createUser);
router.get("/users/:id/stats", getUserStats);
router.put("/users/:id", updateUser);
router.post("/users/:id/reset-password", resetPassword);
router.delete("/users/:id", deleteUser);

// 日志查看
router.get("/logs", getOperationLogs);

// API配置管理
router.get("/api-configs", getApiConfigs);
router.put("/api-configs/:apiType", updateApiConfig);

// 分类管理
router.get("/categories", getAllCategories);
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

export default router;
