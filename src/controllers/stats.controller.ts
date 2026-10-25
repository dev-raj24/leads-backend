import type { Request, Response } from "express";
import * as statsService from "../services/stats.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";

const ALLOWED_DAYS = [7, 14, 30];

export const overview = asyncHandler(async (req: Request, res: Response) => {
  const days = req.query.days === undefined ? 14 : Number(req.query.days);
  if (!ALLOWED_DAYS.includes(days)) throw badRequest("invalid_days");

  const tz = typeof req.query.tz === "string" && req.query.tz ? req.query.tz : "UTC";
  if (tz.length > 64 || !(await statsService.isValidTimezone(tz))) throw badRequest("invalid_timezone");

  res.json({ stats: await statsService.getOverview(req.tenantId!, days, tz) });
});
