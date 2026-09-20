// routes/auth.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { limits } from "../middleware/rateLimit.middleware";

export const authRoutes = Router();

authRoutes.post("/auth/signup", limits.auth, authController.signup);
authRoutes.post("/auth/login", limits.auth, authController.login);
