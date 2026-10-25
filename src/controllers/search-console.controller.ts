import type { Request, Response } from "express";
import { env } from "../config/env";
import * as sc from "../services/search-console.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

export const status = asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: await sc.getStatus(req.tenantId!) });
});

/** POST /api/search-console/connect → { url } — send the owner to Google's consent screen. */
export const connect = asyncHandler(async (req: Request, res: Response) => {
  res.json({ url: sc.consentUrl(req.tenantId!) });
});

/** GET /api/public/google/callback — Google sends the owner back here with a one-time code. */
export const callback = asyncHandler(async (req: Request, res: Response) => {
  const back = (qs: string) => res.redirect(`${env.appUrl}/seo?tab=rankings&${qs}`);
  if (typeof req.query.error === "string") return back("error=denied");
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string") return back("error=invalid");
  try {
    await sc.completeConnection(code, state);
    return back("connected=1");
  } catch (err) {
    console.error("[search-console]", err instanceof Error ? err.message : err);
    return back("error=failed");
  }
});

export const properties = asyncHandler(async (req: Request, res: Response) => {
  res.json({ properties: await sc.listProperties(req.tenantId!) });
});

export const choose = asyncHandler(async (req: Request, res: Response) => {
  const siteUrl = req.body?.siteUrl;
  if (!isNonEmptyString(siteUrl)) throw badRequest("missing_site_url");
  await sc.chooseProperty(req.tenantId!, siteUrl);
  res.json({ status: await sc.getStatus(req.tenantId!) });
});

export const performance = asyncHandler(async (req: Request, res: Response) => {
  const days = Number(req.query.days ?? 28);
  if (![7, 28, 90].includes(days)) throw badRequest("invalid_range");
  res.json({ performance: await sc.getPerformance(req.tenantId!, days, req.query.refresh === "1") });
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  await sc.disconnect(req.tenantId!);
  res.json({ status: await sc.getStatus(req.tenantId!) });
});

