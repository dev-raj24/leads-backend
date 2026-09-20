export type FollowupStatus = "pending" | "approved" | "processing" | "sent" | "manual" | "cancelled";

export interface Followup {
  id: string;
  leadId: string;
  leadName: string;
  leadContact: string;
  runAt: string;
  status: FollowupStatus;
  template: string | null;
  channel: string | null;
  sentAt: string | null;
}

export interface DueFollowup {
  id: string;
  leadId: string;
  template: string | null;
}

export interface FollowupLead {
  id: string;
  tenantId: string;
  name: string | null;
  contact: string;
  message: string | null;
  status: string;
  source: string;
}
