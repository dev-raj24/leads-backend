import type { Request, Response } from "express";
import * as followupService from "../services/followup.service";
import { asyncHandler } from "../utils/asyncHandler";

/** GET /api/followups */
export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followups: await followupService.getFollowupsForTenant(req.tenantId!) });
});
