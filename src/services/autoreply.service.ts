import { env } from "../config/env";
import * as aiService from "./ai.service";
import * as leadService from "./lead.service";
import * as mailer from "./mailer.service";
import * as messageService from "./message.service";
import type { Lead } from "../types";

const REPLY_TIMEOUT_MS = 8000;
const HOURLY_CAP = 60;

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

export async function replyToNewLead(tenantId: string, settings: Record<string, unknown>, lead: Lead): Promise<string | null> {
  if (!env.anthropicApiKey || settings.autoreply === false) return null;

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await messageService.countAiRepliesSince(tenantId, since)) >= HOURLY_CAP) return null;

    const reply = await withTimeout(aiService.draftLeadReply(tenantId, lead), REPLY_TIMEOUT_MS);
    if (!reply) return null;

    const byEmail = mailer.isMailConfigured() && mailer.looksLikeEmail(lead.contact);
    const emailed = byEmail && (await mailer.sendMail({ to: lead.contact, subject: "Thanks for your enquiry", text: reply }));
    const channel = emailed ? "email" : "form";

    await messageService.addMessage(lead.id, { channel, direction: "outbound", body: reply, aiGenerated: true });
    await leadService.recordEvent(lead.id, "ai_reply_sent", { channel });
    return reply;
  } catch (err) {
    console.error("[autoreply]", err);
    return null;
  }
}
