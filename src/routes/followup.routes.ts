// routes/followup.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as followupController from "../controllers/followup.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const followupRoutes = Router();

followupRoutes.get("/followups", requireAuth, followupController.list);
