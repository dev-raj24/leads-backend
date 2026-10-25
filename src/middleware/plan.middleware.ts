// middleware/plan.middleware.ts — blocks Pro-only routes for tenants on the free plan.

import type { NextFunction, Request, Response } from "express";
import { getTenant } from "../services/tenant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { forbidden } from "../utils/errors";

export const requirePro = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const tenant = await getTenant(req.tenantId!);
  if (tenant.plan !== "pro") throw forbidden("pro_required", "This feature is only available on the Pro plan.");
  next();
});
