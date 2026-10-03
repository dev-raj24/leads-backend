import { query } from "../config/db";
import { env } from "../config/env";
import * as leadService from "./lead.service";
import * as mailer from "./mailer.service";
import type { Lead } from "../types";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export async function ownerEmails(tenantId: string): Promise<string[]> {
  const rows = await query<{ email: string }>(
    `select email from users where tenant_id = $1 and role = 'owner' and email_verified_at is not null`,
    [tenantId]
  );
  return rows.map((r) => r.email);
}

async function deliver(tenantId: string, leadId: string, subject: string, text: string, kind: string): Promise<boolean> {
  if (!mailer.isMailConfigured()) return false;
  const recipients = await ownerEmails(tenantId);
  if (recipients.length === 0) {
    await leadService.recordEvent(leadId, "owner_alert_skipped", { kind, reason: "email_not_verified" });
    return false;
  }
  const results = await Promise.all(recipients.map((to) => mailer.sendMail({ to, subject, text })));
  const sent = results.some(Boolean);
  await leadService.recordEvent(leadId, sent ? "owner_alerted" : "owner_alert_failed", { kind, recipients: recipients.length });
  return sent;
}

export async function notifyOwnerOfNewLead(tenantId: string, settings: Record<string, unknown>, lead: Lead): Promise<boolean> {
  if (settings.alerts === false) return false;

  const who = lead.name ?? lead.contact;
  const text = [
    `${who} just sent an enquiry.`,
    "",
    `Contact: ${lead.contact}`,
    lead.message ? `Message: ${clip(lead.message, 500)}` : null,
    "",
    `Reply first: ${env.appUrl}/leads/${lead.id}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return deliver(tenantId, lead.id, `New lead: ${who}`, text, "lead");
}

export async function notifyOwnerOfNewChat(tenantId: string, settings: Record<string, unknown>, lead: Lead, firstMessage: string): Promise<boolean> {
  if (settings.alerts === false) return false;

  const who = lead.name ?? "A website visitor";
  const text = [
    `${who} started a chat on your website.`,
    "",
    `They said: ${clip(firstMessage, 500)}`,
    "",
    `Open the conversation: ${env.appUrl}/ai-widget`,
  ].join("\n");

  return deliver(tenantId, lead.id, `New chat on your website`, text, "chat");
}
