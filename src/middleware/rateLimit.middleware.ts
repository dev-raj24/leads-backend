import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env";

interface LimiterOptions {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
}

export function createLimiter({ windowMs, max, key }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: key ?? ((req) => ipKeyGenerator(req.ip ?? "")),
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  });
}

const MINUTE = 60_000;

export const limits = {
  api: createLimiter({ windowMs: MINUTE, max: env.rateLimits.apiMax }),
  auth: createLimiter({ windowMs: 15 * MINUTE, max: env.rateLimits.authMax }),
  ingest: createLimiter({
    windowMs: MINUTE,
    max: env.rateLimits.ingestMax,
    key: (req) => `${ipKeyGenerator(req.ip ?? "")}:${String(req.body?.site_key ?? req.body?.siteKey ?? "")}`,
  }),
  ai: createLimiter({ windowMs: MINUTE, max: env.rateLimits.aiMax, key: (req) => req.tenantId ?? ipKeyGenerator(req.ip ?? "") }),
};
