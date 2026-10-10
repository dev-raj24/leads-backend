import type { Request, Response } from "express";
import * as seo from "../services/seo-audit.service";
import * as siteService from "../services/site.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength } from "../utils/validate";

/** GET /api/seo/audits — latest scans, plus the address we would scan by default. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const [audits, site] = await Promise.all([seo.listAudits(req.tenantId!), siteService.getPrimarySiteForTenant(req.tenantId!)]);
  const allowed = site ? siteService.normalizeDomainList(site.settings.allowedDomains) : [];
  res.json({ audits: audits.map(({ result, ...rest }) => ({ ...rest, pageCount: result?.pages.length ?? 0 })), suggestedUrl: allowed[0] ? `https://${allowed[0]}` : site?.domain ?? "" });
});

/** GET /api/seo/audits/:id */
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const audit = await seo.getAudit(req.tenantId!, req.params.id);
  if (!audit) throw notFound();
  res.json({ audit });
});

/** POST /api/seo/audits — { url } */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const url = req.body?.url;
  if (!isNonEmptyString(url)) throw badRequest("missing_url");
  limitLength(url, 300, "url_too_long");
  res.status(202).json({ audit: await seo.startAudit(req.tenantId!, url) });
});
