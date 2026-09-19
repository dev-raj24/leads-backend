export interface Followup {
  id: string;
  leadId: string;
  leadName: string;
  runAt: string;
  status: "pending" | "sent" | "cancelled";
  template: string | null;
}
