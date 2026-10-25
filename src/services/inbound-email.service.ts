import { query } from "../config/db";
import { isAutomatedAddress, normalizeContact } from "../utils/contact";
import * as alertService from "./alert.service";
import * as leadService from "./lead.service";
import * as mailer from "./mailer.service";
import * as messageService from "./message.service";

export interface InboundEmail {
  from: string;
  recipients: string;
  subject: string;
  text: string;
  messageId: string | null;
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const flat = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flat).join(" ");
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(flat).join(" ");
  return "";
};

const pick = (d: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] !== "") return d[k];
  return undefined;
};

const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

export function parseInbound(body: unknown): InboundEmail | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const d = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;

  const from = flat(pick(d, "from", "From", "sender", "FromFull"));
  const recipients = flat([pick(d, "to", "To", "recipient", "OriginalRecipient", "ToFull"), pick(d, "cc", "Cc")]);
  const fromEmail = EMAIL_IN_TEXT.exec(from)?.[0];
  if (!fromEmail || !recipients) return null;

  const stripped = pick(d, "StrippedTextReply");
  const textRaw = pick(d, "text", "TextBody", "plain", "body-plain");
  const htmlRaw = pick(d, "html", "HtmlBody", "body-html");
  const text = typeof stripped === "string" ? stripped : typeof textRaw === "string" ? textRaw : typeof htmlRaw === "string" ? htmlToText(htmlRaw) : "";

  const headerId = Array.isArray(d.headers)
    ? (d.headers as Array<{ name?: string; value?: string }>).find((h) => h?.name?.toLowerCase() === "message-id")?.value
    : undefined;
  const id = pick(d, "message_id", "MessageID", "messageId", "Message-Id") ?? headerId;

  return {
    from: fromEmail.toLowerCase(),
    recipients,
    subject: typeof pick(d, "subject", "Subject") === "string" ? (pick(d, "subject", "Subject") as string) : "",
    text,
    messageId: typeof id === "string" && id ? id.slice(0, 300) : null,
  };
}

const QUOTE_START = [
  /^\s*On .{5,200}wrote:\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*From:\s.+@.+/i,
  /^\s*Sent from my /i,
  /^\s*_{5,}\s*$/,
  /^\s*Don't want these messages\?/i,
  /^\s*—\s*$/,
];

export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (QUOTE_START.some((re) => re.test(line))) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim().slice(0, 4000);
}

export type InboundResult = "stored" | "duplicate" | "unknown_lead" | "sender_mismatch" | "ignored" | "empty";

export async function handleInbound(mail: InboundEmail): Promise<InboundResult> {
  const leadId = mailer.leadIdFromReplyAddress(mail.recipients);
  if (!leadId) return "unknown_lead";

  const rows = await query<{ id: string; tenant_id: string; contact: string; contact_key: string | null; name: string | null }>(
    `select id, tenant_id, contact, contact_key, name from leads where id = $1`,
    [leadId]
  );
  const lead = rows[0];
  if (!lead) return "unknown_lead";

  if (normalizeContact(mail.from).key !== (lead.contact_key ?? normalizeContact(lead.contact).key)) {
    await leadService.recordEvent(lead.id, "inbound_rejected", { reason: "sender_mismatch" });
    return "sender_mismatch";
  }
  if (isAutomatedAddress(mail.from) || /^(automatic reply|auto[- ]?reply|out of office|undeliverable|delivery status)/i.test(mail.subject.trim())) {
    return "ignored";
  }

  const body = stripQuoted(mail.text);
  if (!body) return "empty";

  const inserted = await query<{ id: string }>(
    `insert into messages (lead_id, channel, direction, body, external_id)
     values ($1, 'email', 'inbound', $2, $3)
     on conflict do nothing returning id`,
    [lead.id, body, mail.messageId]
  );
  if (inserted.length === 0) return "duplicate";

  await query(`update leads set last_activity_at = now() where id = $1`, [lead.id]);
  await query(`update followups set status = 'cancelled' where lead_id = $1 and status in ('pending', 'approved', 'manual')`, [lead.id]);
  await leadService.recordEvent(lead.id, "customer_replied", { channel: "email" });

  const lastIn = await messageService.countInboundEmailSince(lead.id, new Date(Date.now() - 10 * 60 * 1000));
  if (lastIn <= 1) {
    const full = await leadService.getLeadById(lead.tenant_id, lead.id);
    if (full) await alertService.notifyOwnerOfCustomerReply(lead.tenant_id, full, body);
  }
  return "stored";
}
