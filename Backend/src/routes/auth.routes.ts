import { Router } from "express";
import { register, login, changePassword, refreshToken, logout, getMe } from "../controllers/auth.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

// POST /api/auth/register
router.post("/register", register);

// POST /api/auth/login
router.post("/login", login);

// POST /api/auth/refresh-token (刷新 token)
router.post("/refresh-token", refreshToken);

// GET /api/auth/me (需要登录，返回用户信息含积分)
router.get("/me", authenticateToken, getMe);

// POST /api/auth/logout (需要登录)
router.post("/logout", authenticateToken, logout);

// POST /api/auth/change-password (需要登录)
router.post("/change-password", authenticateToken, changePassword);

export default router;