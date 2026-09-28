// routes/customer.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import * as customerController from "../controllers/customer.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const customerRoutes = Router();

customerRoutes.get("/customers", requireAuth, customerController.list);
customerRoutes.get("/customers/:contact", requireAuth, customerController.detail);
