import type { Request, Response } from "express";
import * as tenantService from "../services/tenant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { env } from "../config/env";
import { AppError, badRequest } from "../utils/errors";
import { limitLength } from "../utils/validate";
import { PLANS, type Plan } from "../types";

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.json({ tenant: await tenantService.getTenant(req.tenantId!) });
});

export const updateName = asyncHandler(async (req: Request, res: Response) => {
  const name = req.body?.name;
  if (typeof name !== "string" || !name.trim()) throw badRequest("missing_business_name");
  res.json({ tenant: await tenantService.setName(req.tenantId!, limitLength(name.trim(), 120, "business_name_too_long")) });
});

export const updateIndustry = asyncHandler(async (req: Request, res: Response) => {
  const industry = req.body?.industry;
  if (typeof industry !== "string" || !industry.trim()) throw badRequest("missing_industry");
  res.json({ tenant: await tenantService.setIndustry(req.tenantId!, limitLength(industry.trim(), 60, "industry_too_long")) });
});

export const choosePlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = req.body?.plan;
  if (!PLANS.includes(plan)) throw badRequest("invalid_plan");
  if (plan === "pro" && !env.selfServePro) throw new AppError(402, "payment_required", "Upgrade to Pro through billing.");
  if (plan === "free" && env.billingConfigured && (await tenantService.getTenant(req.tenantId!)).plan === "pro") {
    throw badRequest("cancel_in_billing");
  }
  res.json({ tenant: await tenantService.choosePlan(req.tenantId!, plan as Plan) });
});
