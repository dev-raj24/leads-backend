import { Router } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import * as reviewController from "../controllers/review.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requirePro } from "../middleware/plan.middleware";
import { createLimiter, limits } from "../middleware/rateLimit.middleware";

export const reviewRoutes = Router();

const limiter = createLimiter({ windowMs: 60_000, max: 30, key: (req) => req.tenantId ?? ipKeyGenerator(req.ip ?? "") });

reviewRoutes.get("/public/google-reviews/callback", reviewController.callback);
reviewRoutes.get("/reviews/status", requireAuth, reviewController.status);
reviewRoutes.post("/reviews/connect", requireAuth, requirePro, limiter, reviewController.connect);
reviewRoutes.get("/reviews/locations", requireAuth, requirePro, limiter, reviewController.locations);
reviewRoutes.put("/reviews/location", requireAuth, requirePro, limiter, reviewController.choose);
reviewRoutes.get("/reviews", requireAuth, requirePro, reviewController.list);
reviewRoutes.post("/reviews/sync", requireAuth, requirePro, limiter, reviewController.sync);
reviewRoutes.post("/reviews/:id/regenerate", requireAuth, requirePro, limits.ai, reviewController.regenerate);
reviewRoutes.post("/reviews/:id/skip", requireAuth, requirePro, limiter, reviewController.skip);
reviewRoutes.post("/reviews/:id/send", requireAuth, requirePro, limiter, reviewController.send);
reviewRoutes.delete("/reviews", requireAuth, requirePro, limiter, reviewController.disconnect);
