import * as aiService from "./ai.service";
import * as followupService from "./followup.service";
import * as leadService from "./lead.service";
import * as mailer from "./mailer.service";
import * as messageService from "./message.service";
import type { DueFollowup, FollowupLead } from "../types";

const BATCH_SIZE = 20;

const fallbackText = (lead: FollowupLead) =>
  `Hi ${lead.name ?? "there"}, just checking in on your enquiry. Is there anything I can help you with?`;

async function processOne(due: DueFollowup): Promise<void> {
  const lead = await followupService.getLeadForFollowup(due.leadId);
  if (!lead || lead.status !== "new") {
    await followupService.finishFollowup(due.id, "cancelled");
    return;
  }

  const text = due.template ?? (await aiService.draftFollowup(lead.tenantId, lead).catch(() => null)) ?? fallbackText(lead);
  const emailed =
    mailer.isMailConfigured() &&
    mailer.looksLikeEmail(lead.contact) &&
    (await mailer.sendMail({ to: lead.contact, subject: "Following up on your enquiry", text }));

  if (!emailed) {
    await followupService.finishFollowup(due.id, "manual", { template: text });
    return;
  }

  await messageService.addMessage(lead.id, { channel: "email", direction: "outbound", body: text, aiGenerated: !due.template });
  await leadService.recordEvent(lead.id, "followup_sent", { channel: "email" });
  await followupService.finishFollowup(due.id, "sent", { template: text, channel: "email" });
}

export async function runDueFollowups(): Promise<number> {
  await followupService.releaseStuckFollowups(10);
  const claimed = await followupService.claimDueFollowups(BATCH_SIZE);

  for (const due of claimed) {
    try {
      await processOne(due);
    } catch (err) {
      console.error("[followup-runner]", due.id, err);
      await followupService.finishFollowup(due.id, "manual").catch(() => undefined);
    }
  }
  return claimed.length;
}
