import { Router } from "express";
import * as seoController from "../controllers/seo.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { limits } from "../middleware/rateLimit.middleware";
import { requirePro } from "../middleware/plan.middleware";

export const seoRoutes = Router();

seoRoutes.get("/seo/audits", requireAuth, seoController.list);
seoRoutes.get("/seo/audits/:id", requireAuth, seoController.getOne);
seoRoutes.post("/seo/audits", requireAuth, requirePro, seoController.create);
seoRoutes.post("/seo/audits/:id/fixes", requireAuth, requirePro, limits.ai, seoController.writeFixes);
