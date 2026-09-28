import { Router } from "express";
import * as offerController from "../controllers/offer.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requirePro } from "../middleware/plan.middleware";

export const offerRoutes = Router();

// Public — the site widget reads its live offer with a site key, no login.
offerRoutes.get("/public/widget-config", offerController.publicWidgetConfig);

// Owner-portal routes — require a signed-in session (JWT).
// Creating new banners is a Pro feature — managing existing ones stays on every plan.
offerRoutes.get("/offers", requireAuth, offerController.list);
offerRoutes.post("/offers", requireAuth, requirePro, offerController.create);
offerRoutes.patch("/offers/:id", requireAuth, offerController.update);
offerRoutes.delete("/offers/:id", requireAuth, offerController.remove);

