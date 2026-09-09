import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware";
import { runReview } from "../controllers/review.controller";

const router = Router();

router.post("/", authenticateToken, runReview);

export default router;
