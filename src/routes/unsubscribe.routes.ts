import { Router } from "express";
import * as unsubscribeController from "../controllers/unsubscribe.controller";
import * as followupSkipController from "../controllers/followup-skip.controller";
import { limits } from "../middleware/rateLimit.middleware";

export const unsubscribeRoutes = Router();

unsubscribeRoutes.get("/public/unsubscribe", limits.ingest, unsubscribeController.confirmPage);
unsubscribeRoutes.post("/public/unsubscribe", limits.ingest, unsubscribeController.perform);
unsubscribeRoutes.get("/public/followup-skip", limits.ingest, followupSkipController.confirmPage);
unsubscribeRoutes.post("/public/followup-skip", limits.ingest, followupSkipController.perform);
