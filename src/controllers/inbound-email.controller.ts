import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { env } from "../config/env";
import * as inbound from "../services/inbound-email.service";
import { asyncHandler } from "../utils/asyncHandler";

const sameSecret = (given: string) => {
  const a = Buffer.from(env.inboundEmailSecret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** POST /api/public/inbound-email — a mail provider forwards a lead's answer here; it lands in that lead's thread. */
export const receive = asyncHandler(async (req: Request, res: Response) => {
  if (!env.inboundEmailSecret || !env.inboundEmailDomain) return res.status(503).json({ error: "inbound_email_not_configured" });

  const header = req.get("x-inbound-secret");
  const given = typeof header === "string" ? header : typeof req.query.secret === "string" ? req.query.secret : "";
  if (!given || !sameSecret(given)) return res.status(401).json({ error: "invalid_secret" });

  const mail = inbound.parseInbound(req.body);
  if (!mail) return res.status(200).json({ ok: true, result: "unparseable" });

  const result = await inbound.handleInbound(mail);
  res.json({ ok: true, result });
});
