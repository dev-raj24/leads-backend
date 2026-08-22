// routes/lead.routes.ts — url -> controller. No logic here.
import { Router } from "express";
import multer from "multer";
import * as leadController from "../controllers/lead.controller";
import { requireAuth } from "../middleware/auth.middleware";

const upload = multer({ storage: multer.memoryStorage() });
export const leadRoutes = Router();

// Public — a client site's widget/form posts here with a site_key, no login.
leadRoutes.post("/ingest/lead", leadController.ingest);

// Owner-portal routes — require a signed-in session (JWT).
leadRoutes.get("/leads", requireAuth, leadController.list);
leadRoutes.get("/leads/template", requireAuth, leadController.downloadTemplate);
leadRoutes.post("/leads/upload-preview", requireAuth, upload.single("file") as any, leadController.uploadPreview);
leadRoutes.post("/leads/bulk", requireAuth, leadController.bulkIngest);
leadRoutes.get("/leads/:id", requireAuth, leadController.getOne);
leadRoutes.patch("/leads/:id", requireAuth, leadController.updateStatus);
