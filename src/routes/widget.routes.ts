// routes/widget.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as widgetController from "../controllers/widget.controller";
import { limits } from "../middleware/rateLimit.middleware";

export const widgetRoutes = Router();

// Public — the embedded chat bubble posts here with a site_key, no login.
widgetRoutes.post("/public/chat/start", limits.ingest, widgetController.start);
widgetRoutes.post("/public/chat/:leadId/message", limits.ingest, widgetController.continueChat);
widgetRoutes.get("/public/chat/:leadId/messages", limits.chatPoll, widgetController.messages);
