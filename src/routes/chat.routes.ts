import { Router } from "express";
import { chatWithAgent } from "../controllers/chat.controller";

export const chatRoutes = Router();

chatRoutes.post("/chat", chatWithAgent);
