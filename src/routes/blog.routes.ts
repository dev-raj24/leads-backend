// routes/blog.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as blogController from "../controllers/blog.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const blogRoutes = Router();

// Public — the site's blog embed script reads published posts, no login.
blogRoutes.get("/public/blog", blogController.publicList);
blogRoutes.get("/public/blog/:slug", blogController.publicGet);

// Owner-portal routes — require a signed-in session (JWT).
blogRoutes.post("/blog/generate", requireAuth, blogController.generate);
blogRoutes.get("/blog", requireAuth, blogController.list);
blogRoutes.post("/blog", requireAuth, blogController.create);
blogRoutes.get("/blog/:id", requireAuth, blogController.getOne);
blogRoutes.patch("/blog/:id", requireAuth, blogController.update);
blogRoutes.delete("/blog/:id", requireAuth, blogController.remove);
