import { Router } from "express";
import * as tenantController from "../controllers/tenant.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const tenantRoutes = Router();

tenantRoutes.get("/tenant/me", requireAuth, tenantController.me);
tenantRoutes.patch("/tenant/name", requireAuth, tenantController.updateName);
tenantRoutes.patch("/tenant/industry", requireAuth, tenantController.updateIndustry);
tenantRoutes.patch("/tenant/plan", requireAuth, tenantController.choosePlan);
