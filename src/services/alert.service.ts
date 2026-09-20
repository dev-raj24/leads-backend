import { query } from "../config/db";
import { env } from "../config/env";
import * as mailer from "./mailer.service";
import type { Lead } from "../types";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

async function ownerEmails(tenantId: string): Promise<string[]> {
  const rows = await query<{ email: string }>(`select email from users where tenant_id = $1 and role = 'owner'`, [tenantId]);
  return rows.map((r) => r.email);
}

export async function notifyOwnerOfNewLead(tenantId: string, settings: Record<string, unknown>, lead: Lead): Promise<void> {
  if (settings.alerts === false || !mailer.isMailConfigured()) return;

  const recipients = await ownerEmails(tenantId);
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

  await Promise.all(recipients.map((to) => mailer.sendMail({ to, subject: `New lead: ${who}`, text })));
}
