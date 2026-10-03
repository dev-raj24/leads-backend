// routes/widget-chat.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as controller from "../controllers/widget-chat.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const widgetChatRoutes = Router();

widgetChatRoutes.get("/chat-widget/conversations", requireAuth, controller.listConversations);
widgetChatRoutes.post("/chat-widget/conversations/:leadId/reply", requireAuth, controller.reply);
