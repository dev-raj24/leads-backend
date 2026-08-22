// controllers/site.controller.ts — req/res only. No SQL.

import type { Request, Response } from "express";
import { DatabaseNotConfiguredError } from "../config/db";
import * as siteService from "../services/site.service";

/** GET /api/sites/me — the signed-in tenant's primary site (embed api_key). */
export async function getMine(req: Request, res: Response) {
  try {
    const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
    if (!site) return res.status(404).json({ error: "not_found" });
    return res.json({ site });
  } catch (err) {
    return handleError(res, err, "site.controller.getMine");
  }
}

/** PATCH /api/sites/:id/settings — { settings: {...} } module on/off flags. */
export async function updateSettings(req: Request, res: Response) {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== "object") {
    return res.status(400).json({ error: "missing_settings" });
  }
  try {
    const site = await siteService.updateSiteSettings(req.tenantId!, req.params.id, settings);
    if (!site) return res.status(404).json({ error: "not_found" });
    return res.json({ site });
  } catch (err) {
    return handleError(res, err, "site.controller.updateSettings");
  }
}

function handleError(res: Response, err: unknown, where: string) {
  if (err instanceof DatabaseNotConfiguredError) {
    return res.status(503).json({ error: "database_not_configured", detail: err.message });
  }
  console.error(`[${where}]`, err);
  return res.status(500).json({ error: "internal_error" });
}
