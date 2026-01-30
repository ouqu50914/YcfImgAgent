import { Router } from "express";
import { register, login, changePassword } from "../controllers/auth.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

// POST /api/auth/register
router.post("/register", register);

// POST /api/auth/login
router.post("/login", login);

// POST /api/auth/change-password (需要登录)
router.post("/change-password", authenticateToken, changePassword);

export default router;