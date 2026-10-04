export const LEAD_STATUSES = ["new", "replied", "closed", "won", "lost"] as const;
export const LEAD_SOURCES = ["form", "chat_widget", "whatsapp", "missed_call", "offer"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface Lead {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string | null;
  contact: string;
  message: string | null;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  qualified: boolean;
  customFields?: Record<string, unknown>;
  createdAt: string;
  lastActivityAt: string;
  lastMessage?: { body: string; direction: "inbound" | "outbound"; aiGenerated: boolean; at: string } | null;
  nextFollowup?: { at: string; status: string } | null;
}

export interface IngestLeadInput {
  siteKey: string;
  name?: string;
  contact: string;
  message?: string;
  source?: LeadSource;
  customFields?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}
