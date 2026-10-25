import type { Request, Response } from "express";
import * as aiService from "../services/ai.service";
import * as followupService from "../services/followup.service";
import * as leadService from "../services/lead.service";
import * as mailer from "../services/mailer.service";
import * as messageService from "../services/message.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { limitLength, optionalString } from "../utils/validate";

const MAX_AHEAD_MS = 90 * 24 * 3600 * 1000;

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followups: await followupService.getFollowupsForTenant(req.tenantId!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const runAt = new Date(req.body?.runAt ?? Date.now() + 48 * 3600 * 1000);
  if (Number.isNaN(runAt.getTime()) || runAt.getTime() > Date.now() + MAX_AHEAD_MS) throw badRequest("invalid_run_at");
  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");

  const followup = await followupService.createFollowup(req.tenantId!, req.params.leadId, runAt, template);
  res.status(201).json({ followup });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");
  res.json({ followup: await followupService.approveFollowup(req.tenantId!, req.params.id, template) });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followup: await followupService.cancelFollowup(req.tenantId!, req.params.id) });
});

export const markSent = asyncHandler(async (req: Request, res: Response) => {
  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");
  res.json({ followup: await followupService.markFollowupSent(req.tenantId!, req.params.id, template) });
});

/** POST /api/followups/:id/draft — AI-drafts (or redrafts) the message for this follow-up's lead. */
export const draft = asyncHandler(async (req: Request, res: Response) => {
  const followup = await followupService.getFollowupById(req.tenantId!, req.params.id);
  const lead = await followupService.getLeadForFollowup(followup.leadId);
  if (!lead) throw notFound();
  res.json({ draft: await aiService.draftFollowup(req.tenantId!, lead) });
});

/** POST /api/followups/:id/send-email — sends a "manual" follow-up by email right now, instead of copy-pasting it yourself. */
export const sendEmail = asyncHandler(async (req: Request, res: Response) => {
  const followup = await followupService.getFollowupById(req.tenantId!, req.params.id);
  if (followup.status !== "manual") throw badRequest("not_manual");

  const lead = await followupService.getLeadForFollowup(followup.leadId);
  if (!lead) throw notFound();
  if (!mailer.looksLikeEmail(lead.contact)) throw badRequest("no_email_on_file");
  if (!mailer.isMailConfigured()) throw badRequest("mail_not_configured");

  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");
  const text = template ?? followup.template ?? `Hi ${lead.name ?? "there"}, just checking in on your enquiry. Is there anything I can help you with?`;

  const sent = await mailer.sendMail({ to: lead.contact, subject: "Following up on your enquiry", text });
  if (!sent) throw badRequest("send_failed");

  await messageService.addMessage(lead.id, { channel: "email", direction: "outbound", body: text, aiGenerated: false });
  await leadService.recordEvent(lead.id, "followup_sent", { channel: "email" });
  await followupService.finishFollowup(req.params.id, "sent", { template: text, channel: "email" });

  res.json({ followup: await followupService.getFollowupById(req.tenantId!, req.params.id) });
});
