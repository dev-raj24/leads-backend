// controllers/site.controller.ts — req/res only. No SQL.

import type { Request, Response } from "express";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { limitJsonSize } from "../utils/validate";

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
  if ("allowedDomains" in settings) settings.allowedDomains = siteService.normalizeDomainList(settings.allowedDomains);

  const site = await siteService.updateSiteSettings(req.tenantId!, req.params.id, settings);
  if (!site) throw notFound();
  res.json({ site });
});

/** GET /api/sites/me/install — has the script ever phoned home, and who was turned away. */
export const installStatus = asyncHandler(async (req: Request, res: Response) => {
  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  if (!site) throw notFound();
  const status = await siteService.getInstallStatus(req.tenantId!, site.id);
  res.json({ status, allowedDomains: siteService.normalizeDomainList(site.settings.allowedDomains) });
});
