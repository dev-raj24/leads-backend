import { createHmac, timingSafeEqual } from "crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { query } from "../config/db";
import { env } from "../config/env";
import { normalizeContact } from "../utils/contact";

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter === undefined) {
    transporter = env.smtpUrl ? nodemailer.createTransport(env.smtpUrl) : null;
  }
  return transporter;
}

export function isMailConfigured(): boolean {
  return Boolean(env.smtpUrl);
}

interface Message {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  headers?: Record<string, string>;
}

const fromAddress = () => env.mailFrom.match(/<([^>]+)>/)?.[1] ?? env.mailFrom;
const cleanName = (name: string) => name.replace(/["<>\r\n]/g, "").trim().slice(0, 80);

export async function sendMail(message: Message): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) return false;
  const { fromName, ...rest } = message;
  const from = fromName && cleanName(fromName) ? `"${cleanName(fromName)}" <${fromAddress()}>` : env.mailFrom;
  try {
    await mailer.sendMail({ from, ...rest });
    return true;
  } catch (err) {
    console.error("[mail]", err instanceof Error ? err.message : err);
    return false;
  }
}

export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const sign = (payload: string) => createHmac("sha256", env.jwtSecret).update(`unsub:${payload}`).digest("base64url");

export function unsubscribeToken(tenantId: string, contactKey: string): string {
  const payload = `${tenantId}.${Buffer.from(contactKey).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function parseUnsubscribeToken(token: string): { tenantId: string; contactKey: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { tenantId: parts[0], contactKey: Buffer.from(parts[1], "base64url").toString() };
}

export async function isUnsubscribed(tenantId: string, contact: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(
    `select 1 as ok from unsubscribes where tenant_id = $1 and contact_key = $2 limit 1`,
    [tenantId, normalizeContact(contact).key]
  );
  return rows.length > 0;
}

export async function unsubscribe(tenantId: string, contactKey: string): Promise<void> {
  await query(`insert into unsubscribes (tenant_id, contact_key) values ($1, $2) on conflict do nothing`, [tenantId, contactKey]);
}

const replySig = (leadId: string) => createHmac("sha256", env.jwtSecret).update(`reply:${leadId}`).digest("hex").slice(0, 16);

/** Where a lead's answer should go: back into the portal when an inbound domain is set, otherwise to the owner's own inbox. */
export function replyAddressFor(leadId: string, fallback?: string): string | undefined {
  if (!env.inboundEmailDomain) return fallback;
  return `reply+${leadId}.${replySig(leadId)}@${env.inboundEmailDomain}`;
}

export function leadIdFromReplyAddress(address: string): string | null {
  const m = /reply\+([0-9a-f-]{36})\.([0-9a-f]{16})@([^\s>]+)/i.exec(address);
  if (!m || m[3].toLowerCase() !== env.inboundEmailDomain) return null;
  const expected = Buffer.from(replySig(m[1].toLowerCase()));
  const given = Buffer.from(m[2].toLowerCase());
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return m[1].toLowerCase();
}
