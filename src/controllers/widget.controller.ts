// controllers/widget.controller.ts — public, unauthenticated chat-widget endpoints.
// The visitor never signs in; everything here resolves off `siteKey`, same as /ingest/lead.

import type { Request, Response } from "express";
import type { ChatTurn } from "../config/gemini";
import * as aiService from "../services/ai.service";
import * as leadService from "../services/lead.service";
import * as messageService from "../services/message.service";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
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

/** POST /api/public/chat/start — { siteKey, name?, contact, message } → { leadId, reply } */
export const start = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const site = await resolveActiveWidgetSite(body.siteKey);

  const contact = optionalString(body.contact);
  if (!contact) throw badRequest("missing_contact");
  const message = optionalString(body.message);
  if (!message) throw badRequest("missing_message");

  const { lead } = await leadService.createFromSite({
    siteKey: site.apiKey,
    contact: limitLength(contact, 160, "contact_too_long"),
    name: limitLength(optionalString(body.name), 120, "name_too_long"),
    message: limitLength(message, 2000, "message_too_long"),
    source: "chat_widget",
  });

  const turns: ChatTurn[] = [{ role: "user", content: message }];
  const reply = await withTimeout(aiService.replyInWidgetChat(site.tenantId, turns)).catch(() => null);
  const replyText = reply || FALLBACK_REPLY;

  const out = await messageService.addMessage(lead.id, {
    channel: "chat",
    direction: "outbound",
    body: replyText,
    aiGenerated: true,
  });

  res.status(201).json({ leadId: lead.id, reply: replyText, cursor: out.createdAt });
});

/** POST /api/public/chat/:leadId/message — { siteKey, message } → { reply } */
export const continueChat = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const site = await resolveActiveWidgetSite(body.siteKey);

  const message = optionalString(body.message);
  if (!message) throw badRequest("missing_message");
  const text = limitLength(message, 2000, "message_too_long");

  const lead = await leadService.getLeadById(site.tenantId, req.params.leadId);
  if (!lead || lead.siteId !== site.id) throw notFound();

  const inbound = await messageService.addMessage(lead.id, { channel: "chat", direction: "inbound", body: text });

  const history = await messageService.getMessagesForLead(site.tenantId, lead.id);

  // A teammate stepped in recently — stay quiet so the AI doesn't talk over them.
  const lastOutbound = [...history].reverse().find((m) => m.direction === "outbound");
  if (lastOutbound && !lastOutbound.aiGenerated && Date.now() - ms(lastOutbound.createdAt) < HANDOFF_MS) {
    res.json({ reply: null, handoff: true, cursor: inbound.createdAt });
    return;
  }

  const turns: ChatTurn[] = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body,
  }));

  const reply = await withTimeout(aiService.replyInWidgetChat(site.tenantId, turns)).catch(() => null);
  const replyText = reply || FALLBACK_REPLY;

  const out = await messageService.addMessage(lead.id, {
    channel: "chat",
    direction: "outbound",
    body: replyText,
    aiGenerated: true,
  });

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
