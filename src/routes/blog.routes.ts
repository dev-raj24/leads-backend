// routes/blog.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as blogController from "../controllers/blog.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requirePro } from "../middleware/plan.middleware";
import { limits } from "../middleware/rateLimit.middleware";

export const blogRoutes = Router();

// Public — the site's blog embed script reads published posts, no login.
blogRoutes.get("/public/blog", blogController.publicList);
blogRoutes.get("/public/blog/:slug", blogController.publicGet);

// Owner-portal routes — require a signed-in session (JWT).
// AI generation is a Pro feature — writing/editing/publishing drafts by hand stays on every plan.
blogRoutes.post("/blog/generate", requireAuth, requirePro, limits.ai, blogController.generate);
blogRoutes.get("/blog", requireAuth, blogController.list);
blogRoutes.post("/blog", requireAuth, blogController.create);
blogRoutes.get("/blog/:id", requireAuth, blogController.getOne);
blogRoutes.patch("/blog/:id", requireAuth, blogController.update);
blogRoutes.delete("/blog/:id", requireAuth, blogController.remove);
