const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NormalizedContact {
  contact: string;
  key: string;
  kind: "email" | "phone" | "other";
}

export function normalizeContact(raw: string): NormalizedContact {
  const trimmed = raw.trim();
  if (EMAIL_RE.test(trimmed)) {
    const email = trimmed.toLowerCase();
    return { contact: email, key: email, kind: "email" };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 7) {
    return { contact: trimmed, key: digits.length >= 10 ? digits.slice(-10) : digits, kind: "phone" };
  }
  return { contact: trimmed, key: trimmed.toLowerCase(), kind: "other" };
}

const AUTOMATED_LOCAL_PARTS = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|notifications?|automated?|auto-?reply)([+._-].*)?$/i;

export function isAutomatedAddress(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return AUTOMATED_LOCAL_PARTS.test(local);
}

export function findContactInText(text: string): string | null {
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) return email[0];
  const phone = text.match(/(?:\+?\d[\d\s().-]{8,16}\d)/);
  if (phone && phone[0].replace(/\D/g, "").length >= 10) return phone[0].trim();
  return null;
}
