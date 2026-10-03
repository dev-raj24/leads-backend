// controllers/widget.controller.ts — public, unauthenticated chat-widget endpoints.
// The visitor never signs in; everything here resolves off `siteKey`, same as /ingest/lead.

import type { Request, Response } from "express";
import type { ChatTurn } from "../config/gemini";
import { randomBytes } from "crypto";
import * as aiConfigService from "../services/ai-config.service";
import * as aiService from "../services/ai.service";
import * as alertService from "../services/alert.service";
import * as leadIntake from "../services/lead-intake.service";
import * as leadService from "../services/lead.service";
import * as messageService from "../services/message.service";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
import * as usageService from "../services/usage.service";
import { planDef } from "../config/plans";
import { query } from "../config/db";
import { findContactInText, normalizeContact } from "../utils/contact";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength, optionalString } from "../utils/validate";
import type { Site } from "../types/site";

async function resolveActiveWidgetSite(siteKey: unknown): Promise<Site> {
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  const site = await siteService.getSiteByApiKey(siteKey);
  if (!site) throw badRequest("invalid_site_key");

  const tenant = await getTenant(site.tenantId);
  if (tenant.plan !== "pro" || site.settings?.widget !== true) {
    throw forbidden("widget_disabled", "The chat widget isn't enabled for this site.");
  }
  return site;
}

// pg hands back Date objects even though the type says string; Date.parse(Date) would drop the milliseconds.
const ms = (v: string | Date) => new Date(v).getTime();

const REPLY_TIMEOUT_MS = 12_000;
const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), REPLY_TIMEOUT_MS))]);

const HANDOFF_MS = 30 * 60 * 1000;
const FALLBACK_REPLY = "Thanks for reaching out — the team will follow up with you directly.";

async function aiChatBudgetLeft(tenantId: string, plan: string): Promise<boolean> {
  const cap = planDef(plan).aiChatMessagesPerMonth;
  const rows = await query<{ count: number }>(
    `select count(*)::int as count from messages m join leads l on l.id = m.lead_id
     where l.tenant_id = $1 and m.channel = 'chat' and m.direction = 'outbound' and m.ai_generated = true
       and m.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`,
    [tenantId]
  );
  return (rows[0]?.count ?? 0) < cap;
}

async function chatReply(site: Site, turns: ChatTurn[]): Promise<string> {
  const tenant = await getTenant(site.tenantId);
  if (!(await aiChatBudgetLeft(site.tenantId, tenant.plan))) return FALLBACK_REPLY;
  if (!(await aiConfigService.isProfileReady(site.tenantId))) return FALLBACK_REPLY;
  const reply = await withTimeout(aiService.replyInWidgetChat(site.tenantId, turns)).catch(() => null);
  return reply || FALLBACK_REPLY;
}

const isContactLike = (v: string) => normalizeContact(v).kind !== "other";

/** POST /api/public/chat/start — { siteKey, name?, contact?, message } → { leadId, reply } */
export const start = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const site = await resolveActiveWidgetSite(body.siteKey);

  const message = optionalString(body.message);
  if (!message) throw badRequest("missing_message");
  const text = limitLength(message, 2000, "message_too_long");

  const given = optionalString(body.contact);
  const found = (given && isContactLike(given) ? given : null) ?? findContactInText(text);
  const qualified = Boolean(found);
  const contact = found ?? `visitor-${randomBytes(5).toString("hex")}`;

  const { lead, siteSettings } = await leadService.createFromSite({
    siteKey: site.apiKey,
    contact: limitLength(contact, 160, "contact_too_long"),
    name: limitLength(optionalString(body.name), 120, "name_too_long"),
    message: text,
    source: "chat_widget",
    qualified,
  });

  if (qualified) {
    await leadIntake.afterNewLead(site.tenantId, siteSettings, lead, { awaitReply: false, skipReply: true });
  } else {
    alertService.notifyOwnerOfNewChat(site.tenantId, siteSettings, lead, text).catch((err) => console.error("[alert]", err));
  }

  const replyText = await chatReply(site, [{ role: "user", content: text }]);
  const out = await messageService.addMessage(lead.id, { channel: "chat", direction: "outbound", body: replyText, aiGenerated: true });

  res.status(201).json({ leadId: lead.id, reply: replyText, cursor: out.createdAt });
});

/** POST /api/public/chat/:leadId/message — { siteKey, message, contact? } → { reply } */
export const continueChat = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const site = await resolveActiveWidgetSite(body.siteKey);

  const message = optionalString(body.message);
  if (!message) throw badRequest("missing_message");
  const text = limitLength(message, 2000, "message_too_long");

  const lead = await leadService.getLeadById(site.tenantId, req.params.leadId);
  if (!lead || lead.siteId !== site.id) throw notFound();

  const inbound = await messageService.addMessage(lead.id, { channel: "chat", direction: "inbound", body: text });

  if (!lead.qualified) {
    const given = optionalString(body.contact);
    const found = (given && isContactLike(given) ? given : null) ?? findContactInText(text);
    if (found) {
      const promoted = await leadService.promoteToLead(site.tenantId, lead.id, limitLength(found, 160, "contact_too_long"));
      if (promoted) await leadIntake.afterNewLead(site.tenantId, site.settings, promoted, { awaitReply: false, skipReply: true });
    }
  }

  const history = await messageService.getMessagesForLead(site.tenantId, lead.id);

  const lastOutbound = [...history].reverse().find((m) => m.direction === "outbound");
  if (lastOutbound && !lastOutbound.aiGenerated && Date.now() - ms(lastOutbound.createdAt) < HANDOFF_MS) {
    res.json({ reply: null, handoff: true, cursor: inbound.createdAt });
    return;
  }

  const turns: ChatTurn[] = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body,
  }));

  const replyText = await chatReply(site, turns);
  const out = await messageService.addMessage(lead.id, { channel: "chat", direction: "outbound", body: replyText, aiGenerated: true });

  res.json({ reply: replyText, cursor: out.createdAt });
});

/** GET /api/public/chat/:leadId/messages?siteKey=&after= — lets the bubble show teammate replies live. */
export const messages = asyncHandler(async (req: Request, res: Response) => {
  const site = await resolveActiveWidgetSite(req.query.siteKey);
  const lead = await leadService.getLeadById(site.tenantId, req.params.leadId);
  if (!lead || lead.siteId !== site.id) throw notFound();

  const after = typeof req.query.after === "string" ? Date.parse(req.query.after) : NaN;
  const all = await messageService.getMessagesForLead(site.tenantId, lead.id);
  const fresh = Number.isNaN(after) ? all : all.filter((m) => ms(m.createdAt) > after);

  res.json({
    messages: fresh.map((m) => ({
      id: m.id,
      from: m.direction === "inbound" ? "visitor" : m.aiGenerated ? "ai" : "team",
      body: m.body,
      createdAt: m.createdAt,
    })),
  });
});
