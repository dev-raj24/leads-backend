import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

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

export async function sendMail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) return false;
  try {
    await mailer.sendMail({ from: env.mailFrom, ...message });
    return true;
  } catch (err) {
    console.error("[mail]", err instanceof Error ? err.message : err);
    return false;
  }
}

export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
