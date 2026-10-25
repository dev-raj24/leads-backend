import type { Request, Response } from "express";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

export const DEFAULT_CONSENT = "We will only use these details to reply to your enquiry.";

export const consentFor = (settings: Record<string, unknown>) =>
  typeof settings.formConsent === "string" && settings.formConsent.trim() ? settings.formConsent.trim().slice(0, 200) : DEFAULT_CONSENT;

/** GET /api/public/form?siteKey= — what the hosted form page at /f/<key> shows. */
export const publicForm = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  const site = await siteService.getSiteByApiKey(siteKey);
  if (!site) throw notFound("invalid_site_key");
  const tenant = await getTenant(site.tenantId);
  res.json({
    businessName: tenant.name,
    fields: siteService.normalizeLeadFields(site.settings.leadFields),
    consent: consentFor(site.settings),
    poweredBy: tenant.plan !== "pro",
  });
});
