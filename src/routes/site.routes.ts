// routes/site.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import * as siteController from "../controllers/site.controller";

export const siteRoutes = Router();

siteRoutes.get("/sites/me", requireAuth, siteController.getMine);
siteRoutes.patch("/sites/:id/settings", requireAuth, siteController.updateSettings);
