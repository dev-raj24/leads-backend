import { query } from "../config/db";
import { env } from "../config/env";
import { planDef } from "../config/plans";
import * as aiConfigService from "./ai-config.service";
import * as aiService from "./ai.service";
import * as alertService from "./alert.service";
import * as leadService from "./lead.service";
import * as automatedMail from "./automated-mail.service";
import * as mailer from "./mailer.service";
import * as messageService from "./message.service";
import { getTenant } from "./tenant.service";
import type { Lead } from "../types";

const REPLY_TIMEOUT_MS = 8000;
const HOURLY_CAP = 60;

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function alreadyRepliedToday(leadId: string, tenantId: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `select 1 as ok from messages m
     join leads l on l.id = m.lead_id
     where l.tenant_id = $1 and l.contact_key = (select contact_key from leads where id = $2)
       and m.direction = 'outbound' and m.ai_generated = true
       and m.created_at >= now() - interval '24 hours' and m.lead_id <> $2
     limit 1`,
    [tenantId, leadId]
  );
  return rows.length > 0;
}

export async function replyToNewLead(tenantId: string, settings: Record<string, unknown>, lead: Lead): Promise<string | null> {
  if (!env.geminiApiKey || settings.autoreply === false) return null;

  try {
    const tenant = await getTenant(tenantId);
    if (!planDef(tenant.plan).features.aiReply) return null;
    if (!(await aiConfigService.isProfileReady(tenantId))) {
      await leadService.recordEvent(lead.id, "ai_reply_skipped", { reason: "profile_incomplete" });
      return null;
    }
    if (await alreadyRepliedToday(lead.id, tenantId)) {
      await leadService.recordEvent(lead.id, "ai_reply_skipped", { reason: "already_replied_today" });
      return null;
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await messageService.countAiRepliesSince(tenantId, since)) >= HOURLY_CAP) return null;

    const reply = await withTimeout(aiService.draftLeadReply(tenantId, lead), REPLY_TIMEOUT_MS);
    if (!reply) return null;

    let channel = "form";
    if (mailer.isMailConfigured() && mailer.looksLikeEmail(lead.contact)) {
      const owners = await alertService.ownerEmails(tenantId);
      const result = await automatedMail.sendAutomatedToLead({
        tenantId,
        businessName: tenant.name,
        ownerEmail: owners[0],
        to: lead.contact,
        subject: "Thanks for your enquiry",
        text: reply,
      });
      if (result.sent) channel = "email";
      else if (result.skipped) await leadService.recordEvent(lead.id, "ai_reply_email_skipped", { reason: result.skipped });
    }

    await messageService.addMessage(lead.id, { channel, direction: "outbound", body: reply, aiGenerated: true });
    await leadService.recordEvent(lead.id, "ai_reply_sent", { channel });
    return reply;
  } catch (err) {
    console.error("[autoreply]", err);
    return null;
  }
}
