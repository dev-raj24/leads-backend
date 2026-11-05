import { Router } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import * as reviewController from "../controllers/review.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requirePro } from "../middleware/plan.middleware";
import { createLimiter, limits } from "../middleware/rateLimit.middleware";

export const reviewRoutes = Router();

const limiter = createLimiter({ windowMs: 60_000, max: 30, key: (req) => req.tenantId ?? ipKeyGenerator(req.ip ?? "") });

reviewRoutes.get("/reviews/status", requireAuth, reviewController.status);
reviewRoutes.get("/reviews/search", requireAuth, requirePro, limiter, reviewController.search);
reviewRoutes.put("/reviews/business", requireAuth, requirePro, limiter, reviewController.choose);
reviewRoutes.get("/reviews", requireAuth, requirePro, reviewController.list);
reviewRoutes.post("/reviews/sync", requireAuth, requirePro, limiter, reviewController.sync);
reviewRoutes.post("/reviews/:id/regenerate", requireAuth, requirePro, limits.ai, reviewController.regenerate);
reviewRoutes.post("/reviews/:id/skip", requireAuth, requirePro, limiter, reviewController.skip);
reviewRoutes.post("/reviews/:id/copy", requireAuth, requirePro, limiter, reviewController.copy);
reviewRoutes.delete("/reviews", requireAuth, requirePro, limiter, reviewController.disconnect);
