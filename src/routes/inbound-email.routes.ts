import { Router } from "express";
import * as inboundController from "../controllers/inbound-email.controller";
import { createLimiter } from "../middleware/rateLimit.middleware";

export const inboundEmailRoutes = Router();

const limiter = createLimiter({ windowMs: 60_000, max: 120 });

inboundEmailRoutes.post("/public/inbound-email", limiter, inboundController.receive);
