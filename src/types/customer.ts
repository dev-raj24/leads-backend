export interface CustomerSummary {
  contact: string;
  name: string | null;
  leadCount: number;
  wonCount: number;
  isCustomer: boolean;
  lastSource: string;
  firstSeenAt: string;
  lastActivityAt: string;
}
