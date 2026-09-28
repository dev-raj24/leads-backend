// routes/auth.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { limits } from "../middleware/rateLimit.middleware";

export const authRoutes = Router();

authRoutes.post("/auth/signup", limits.auth, authController.signup);
authRoutes.post("/auth/login", limits.auth, authController.login);
authRoutes.post("/auth/forgot-password", limits.auth, authController.forgotPassword);
authRoutes.post("/auth/reset-password", limits.auth, authController.resetPassword);
authRoutes.patch("/auth/password", requireAuth, limits.auth, authController.changePassword);
authRoutes.patch("/auth/email", requireAuth, limits.auth, authController.changeEmail);
