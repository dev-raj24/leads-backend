import { Router } from "express";
import * as aiConfigController from "../controllers/ai-config.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const aiConfigRoutes = Router();

aiConfigRoutes.get("/ai-config", requireAuth, aiConfigController.get);
aiConfigRoutes.put("/ai-config", requireAuth, aiConfigController.save);
