// controllers/widget-chat.controller.ts — signed-in owner/team side of the website chat.

import type { Request, Response } from "express";
import * as alertService from "../services/alert.service";
import * as mailer from "../services/mailer.service";
import { getTenant } from "../services/tenant.service";
import * as leadService from "../services/lead.service";
import * as messageService from "../services/message.service";
import * as widgetChatService from "../services/widget-chat.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength } from "../utils/validate";

/** GET /api/chat-widget/conversations */
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  res.json({ conversations: await widgetChatService.listConversations(req.tenantId!) });
});

/** POST /api/chat-widget/conversations/:leadId/reply — { text }. Shows up live in the visitor's chat bubble. */
export const reply = asyncHandler(async (req: Request, res: Response) => {
  const text = req.body?.text;
  if (!isNonEmptyString(text)) throw badRequest("missing_text");
  const body = limitLength(text.trim(), 2000, "text_too_long");

  const lead = await leadService.getLeadById(req.tenantId!, req.params.leadId);
  if (!lead || lead.source !== "chat_widget") throw notFound();

  const message = await messageService.addMessage(lead.id, {
    channel: "chat",
    direction: "outbound",
    body,
    aiGenerated: false,
  });
  await leadService.recordEvent(lead.id, "team_chat_reply", { channel: "chat" });
  if (lead.status === "new") await leadService.updateLeadStatus(req.tenantId!, lead.id, "replied");

  if (lead.qualified && mailer.looksLikeEmail(lead.contact) && mailer.isMailConfigured() && (await leadService.visitorIsAway(lead.id))) {
    const [tenant, owners] = await Promise.all([getTenant(req.tenantId!), alertService.ownerEmails(req.tenantId!)]);
    const sent = await mailer.sendMail({
      to: lead.contact,
      subject: `${tenant.name} replied to your chat`,
      text: `${body}\n\n—\nYou can answer by replying to this email.`,
      fromName: tenant.name,
      replyTo: mailer.replyAddressFor(lead.id, owners[0]),
    });
    if (sent) await leadService.recordEvent(lead.id, "chat_reply_emailed", { to: "visitor" });
  }

  res.status(201).json({ message });
});
