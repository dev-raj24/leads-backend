import { Router } from "express";
import * as offerController from "../controllers/offer.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const offerRoutes = Router();

// Owner-portal routes — require a signed-in session (JWT).
offerRoutes.get("/offers", requireAuth, offerController.list);
offerRoutes.post("/offers", requireAuth, offerController.create);
offerRoutes.patch("/offers/:id", requireAuth, offerController.update);
offerRoutes.delete("/offers/:id", requireAuth, offerController.remove);

