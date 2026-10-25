import type { Request, Response } from "express";
import * as aiConfigService from "../services/ai-config.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { limitLength } from "../utils/validate";
import type { BusinessProfile, ServiceItem } from "../types";

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { profile } = await aiConfigService.getBusinessProfile(req.tenantId!);
  res.json({ config: profile });
});

function parseServices(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) throw badRequest("invalid_services");
  if (raw.length > aiConfigService.SERVICE_LIMITS.maxItems) throw badRequest("too_many_services");

  return raw.map((item) => {
    if (typeof item !== "object" || item === null) throw badRequest("invalid_services");
    const { name, description, price, hidePrice } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw badRequest("missing_service_name");
    return {
      name: limitLength(name.trim(), aiConfigService.SERVICE_LIMITS.name, "service_name_too_long"),
      description: limitLength(typeof description === "string" ? description.trim() : "", aiConfigService.SERVICE_LIMITS.description, "service_description_too_long"),
      price: limitLength(typeof price === "string" ? price.trim() : "", aiConfigService.SERVICE_LIMITS.price, "service_price_too_long"),
      hidePrice: hidePrice === true,
    };
  });
}

export const save = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const profile = { services: parseServices(body.services ?? []) } as BusinessProfile;
  for (const field of aiConfigService.TEXT_FIELDS) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    profile[field] = limitLength(value, aiConfigService.textFieldLimit(field), `${field}_too_long`);
  }
  res.json({ config: await aiConfigService.saveBusinessProfile(req.tenantId!, profile) });
});
