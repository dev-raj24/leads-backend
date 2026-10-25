import { Router } from "express";
import * as formController from "../controllers/form.controller";
import { limits } from "../middleware/rateLimit.middleware";

export const formRoutes = Router();

formRoutes.get("/public/form", limits.ingest, formController.publicForm);
