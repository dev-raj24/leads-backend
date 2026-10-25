import { Router } from "express";
import * as billingController from "../controllers/billing.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { limits } from "../middleware/rateLimit.middleware";

export const billingRoutes = Router();

billingRoutes.get("/billing", requireAuth, billingController.overview);
billingRoutes.post("/billing/subscribe", requireAuth, limits.auth, billingController.subscribe);
billingRoutes.post("/billing/cancel", requireAuth, limits.auth, billingController.cancel);
billingRoutes.post("/public/billing/razorpay-webhook", billingController.razorpayWebhook);
