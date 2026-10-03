import { env } from "../config/env";
import { isAutomatedAddress, normalizeContact } from "../utils/contact";
import * as mailer from "./mailer.service";

export type AutomatedSkip = "unsubscribed" | "automated_address" | "invalid_address";

/** Mail the system sends to a lead without a human pressing send: carries a stop link, honours opt-outs. */
export async function sendAutomatedToLead(input: {
  tenantId: string;
  businessName: string;
  ownerEmail?: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; skipped?: AutomatedSkip }> {
  if (!mailer.looksLikeEmail(input.to)) return { sent: false, skipped: "invalid_address" };
  if (isAutomatedAddress(input.to)) return { sent: false, skipped: "automated_address" };
  if (await mailer.isUnsubscribed(input.tenantId, input.to)) return { sent: false, skipped: "unsubscribed" };

  const url = `${env.publicApiUrl}/api/public/unsubscribe?t=${encodeURIComponent(mailer.unsubscribeToken(input.tenantId, normalizeContact(input.to).key))}`;
  const text = `${input.text}\n\n—\nDon't want these messages? Stop them here: ${url}`;
  const sent = await mailer.sendMail({
    to: input.to,
    subject: input.subject,
    text,
    replyTo: input.ownerEmail,
    fromName: input.businessName,
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  return { sent };
}
