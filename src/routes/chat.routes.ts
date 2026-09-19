// routes/chat.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import { chatWithAgent } from "../controllers/chat.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const chatRoutes = Router();

chatRoutes.post("/chat", requireAuth, chatWithAgent);
