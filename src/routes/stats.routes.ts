import { Router } from "express";
import * as statsController from "../controllers/stats.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const statsRoutes = Router();

statsRoutes.get("/stats/overview", requireAuth, statsController.overview);
