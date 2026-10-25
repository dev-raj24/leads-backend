import { Router } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import * as scController from "../controllers/search-console.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requirePro } from "../middleware/plan.middleware";
import { createLimiter } from "../middleware/rateLimit.middleware";

export const searchConsoleRoutes = Router();

const limiter = createLimiter({ windowMs: 60_000, max: 30, key: (req) => req.tenantId ?? ipKeyGenerator(req.ip ?? "") });

searchConsoleRoutes.get("/public/google/callback", scController.callback);
searchConsoleRoutes.get("/search-console/status", requireAuth, scController.status);
searchConsoleRoutes.post("/search-console/connect", requireAuth, requirePro, limiter, scController.connect);
searchConsoleRoutes.get("/search-console/properties", requireAuth, requirePro, limiter, scController.properties);
searchConsoleRoutes.put("/search-console/property", requireAuth, requirePro, limiter, scController.choose);
searchConsoleRoutes.get("/search-console/performance", requireAuth, requirePro, limiter, scController.performance);
searchConsoleRoutes.delete("/search-console", requireAuth, requirePro, limiter, scController.disconnect);
