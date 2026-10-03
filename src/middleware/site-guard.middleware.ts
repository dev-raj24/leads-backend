import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import * as siteService from "../services/site.service";
import { normalizeHost } from "../services/site.service";

const originHost = (value: string): string | null => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
};

const dashboardHosts = new Set(env.corsOrigins.flatMap((o) => originHost(o) ?? []));

function requestSource(req: Request): { host: string; raw: string } | null {
  const source = req.get("origin") ?? req.get("referer");
  const raw = source ? originHost(source) : null;
  return raw ? { host: normalizeHost(raw), raw } : null;
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
    const source = requestSource(req);
    if (typeof key !== "string" || !key || !source || dashboardHosts.has(source.raw)) return next();
    const host = source.host;

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
