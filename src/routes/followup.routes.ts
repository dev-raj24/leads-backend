import { Router } from "express";
import * as followupController from "../controllers/followup.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { limits } from "../middleware/rateLimit.middleware";

export const followupRoutes = Router();

followupRoutes.get("/followups", requireAuth, followupController.list);
followupRoutes.post("/leads/:leadId/followups", requireAuth, followupController.create);
followupRoutes.post("/followups/:id/draft", requireAuth, limits.ai, followupController.draft);
followupRoutes.post("/followups/:id/approve", requireAuth, followupController.approve);
followupRoutes.post("/followups/:id/cancel", requireAuth, followupController.cancel);
followupRoutes.post("/followups/:id/mark-sent", requireAuth, followupController.markSent);
followupRoutes.post("/followups/:id/send-email", requireAuth, followupController.sendEmail);
