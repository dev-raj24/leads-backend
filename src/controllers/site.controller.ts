// controllers/site.controller.ts — req/res only. No SQL.

import type { Request, Response } from "express";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { inspectWebsite } from "../services/site-inspect.service";
import { isNonEmptyString, limitJsonSize, limitLength } from "../utils/validate";

/** GET /api/sites/me — the signed-in tenant's primary site (embed api_key). */
export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  if (!site) throw notFound();
  res.json({ site });
});

/** PATCH /api/sites/:id/settings — { settings: {...} } module on/off flags. */
export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw badRequest("missing_settings");
  }
  limitJsonSize(settings, 16_000, "settings_too_large");

  // Automated (unapproved) follow-up sending is a Pro feature — clamp it off for everyone else.
  if (settings.autofollow === true) {
    const tenant = await getTenant(req.tenantId!);
    if (tenant.plan !== "pro") settings.autofollow = false;
  }

  if ("leadFields" in settings) settings.leadFields = siteService.normalizeLeadFields(settings.leadFields);
  if ("formConsent" in settings) settings.formConsent = typeof settings.formConsent === "string" ? settings.formConsent.trim().slice(0, 200) : "";

  const site = await siteService.updateSiteSettings(req.tenantId!, req.params.id, settings);
  if (!site) throw notFound();
  res.json({ site });
});

/** POST /api/sites/me/inspect — { url } — reads the owner's live website and drafts the business profile from it. */
export const inspect = asyncHandler(async (req: Request, res: Response) => {
  const url = req.body?.url;
  if (!isNonEmptyString(url)) throw badRequest("missing_url");
  limitLength(url, 300, "url_too_long");
  const [site, tenant] = await Promise.all([siteService.getPrimarySiteForTenant(req.tenantId!), getTenant(req.tenantId!)]);
  if (!site) throw notFound();
  res.json({ inspection: await inspectWebsite({ url, businessName: tenant.name, pro: tenant.plan === "pro" }) });
});
