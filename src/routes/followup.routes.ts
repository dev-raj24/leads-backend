import { Router } from "express";
import * as followupController from "../controllers/followup.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const followupRoutes = Router();

followupRoutes.get("/followups", requireAuth, followupController.list);
followupRoutes.post("/leads/:leadId/followups", requireAuth, followupController.create);
followupRoutes.post("/followups/:id/approve", requireAuth, followupController.approve);
followupRoutes.post("/followups/:id/cancel", requireAuth, followupController.cancel);
followupRoutes.post("/followups/:id/mark-sent", requireAuth, followupController.markSent);
