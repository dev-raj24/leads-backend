import * as alertService from "./alert.service";
import * as autoReplyService from "./autoreply.service";
import * as followupService from "./followup.service";
import * as leadService from "./lead.service";
import * as usageService from "./usage.service";
import type { Lead } from "../types";

export interface IntakeOutcome {
  reply: string | null;
  automationsPaused: boolean;
}

/** Everything that follows a brand-new, real lead: owner alert, default follow-up, AI reply. Never loses the lead itself. */
export async function afterNewLead(
  tenantId: string,
  settings: Record<string, unknown>,
  lead: Lead,
  options: { awaitReply: boolean; skipReply?: boolean } = { awaitReply: true }
): Promise<IntakeOutcome> {
  alertService.notifyOwnerOfNewLead(tenantId, settings, lead).catch((err) => console.error("[alert]", err));

  const allowed = await usageService.automationsAllowed(tenantId).catch(() => true);
  if (!allowed) {
    await leadService.recordEvent(lead.id, "automation_paused", { reason: "monthly_limit" });
    return { reply: null, automationsPaused: true };
  }

  followupService.scheduleDefaultFollowup(lead.id).catch((err) => console.error("[followup]", err));
  if (options.skipReply) return { reply: null, automationsPaused: false };
  const reply = autoReplyService.replyToNewLead(tenantId, settings, lead);
  if (!options.awaitReply) {
    reply.catch((err) => console.error("[autoreply]", err));
    return { reply: null, automationsPaused: false };
  }
  return { reply: await reply, automationsPaused: false };
}

