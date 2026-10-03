import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import * as siteService from "../services/site.service";
import { normalizeHost } from "../services/site.service";

const dashboardHosts = new Set(env.corsOrigins.map(normalizeHost));

function requestHost(req: Request): string | null {
  const source = req.get("origin") ?? req.get("referer");
  if (!source) return null;
  try {
    return normalizeHost(new URL(source).host);
  } catch {
    return null;
  }
}

const KINDS: Array<[string, string]> = [
  ["/chat", "chat"],
  ["/offers", "offer"],
  ["/blog", "blog"],
  ["/ingest", "form"],
];

const kindOf = (path: string) => KINDS.find(([p]) => path.includes(p))?.[1] ?? "widget";

/** Public embed endpoints: records that the script is alive on a host and refuses hosts outside the owner's allow-list. */
export async function siteGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.query.siteKey ?? req.body?.siteKey ?? req.body?.site_key;
    const host = requestHost(req);
    if (typeof key !== "string" || !key || !host || dashboardHosts.has(host)) return next();

    const site = await siteService.getSiteByApiKey(key);
    if (!site) return next();

    if (!siteService.isHostAllowed(site.settings, host)) {
      siteService.recordBlocked(site.id, host, kindOf(req.path)).catch(() => undefined);
      return res.status(403).json({ error: "domain_not_allowed" });
    }
    siteService.recordSeen(site.id, host).catch(() => undefined);
    next();
  } catch (err) {
    next(err);
  }
}
