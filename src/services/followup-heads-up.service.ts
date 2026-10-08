import { env } from "../config/env";
import * as alertService from "./alert.service";
import * as followupService from "./followup.service";
import * as mailer from "./mailer.service";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Tells the owner about each automatic follow-up about an hour before it goes out, with a one-click way to stop it. */
export async function sendHeadsUps(): Promise<number> {
  if (!mailer.isMailConfigured()) return 0;
  const due = await followupService.claimHeadsUps(25);
  for (const item of due) {
    const owners = await alertService.ownerEmails(item.tenantId);
    if (owners.length === 0) continue;
    const skip = `${env.publicApiUrl}/api/public/followup-skip?t=${encodeURIComponent(mailer.followupSkipToken(item.id))}`;
    const text = [
      `An automatic follow-up to ${item.leadName} goes out at about ${when(item.runAt)} (India time).`,
      "",
      item.template ? `Message: ${item.template}` : "The AI will write it from your business profile.",
      "",
      "If you already spoke to them, stop it here:",
      skip,
      "",
      `Or open the lead: ${env.appUrl}/leads/${item.leadId}`,
    ].join("\n");
    await Promise.all(owners.map((to) => mailer.sendMail({ to, subject: `Follow-up to ${item.leadName} goes out soon`, text })));
  }
  return due.length;
}
