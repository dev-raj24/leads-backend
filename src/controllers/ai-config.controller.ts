import type { Request, Response } from "express";
import * as aiConfigService from "../services/ai-config.service";
import { asyncHandler } from "../utils/asyncHandler";
import { limitLength } from "../utils/validate";
import type { BusinessProfile } from "../types";

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { profile } = await aiConfigService.getBusinessProfile(req.tenantId!);
  res.json({ config: profile });
});

export const save = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const profile = {} as BusinessProfile;
  for (const field of aiConfigService.PROFILE_FIELDS) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    profile[field] = limitLength(value, aiConfigService.profileFieldLimit(field), `${field}_too_long`);
  }
  res.json({ config: await aiConfigService.saveBusinessProfile(req.tenantId!, profile) });
});
