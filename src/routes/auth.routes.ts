// routes/auth.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as authController from "../controllers/auth.controller";

export const authRoutes = Router();

authRoutes.post("/auth/signup", authController.signup);
authRoutes.post("/auth/login", authController.login);
