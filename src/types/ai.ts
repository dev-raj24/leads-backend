export interface BusinessProfile {
  about: string;
  services: string;
  timings: string;
  tone: string;
  faqs: string;
}

export interface Message {
  id: string;
  leadId: string;
  channel: string;
  direction: "inbound" | "outbound";
  body: string;
  aiGenerated: boolean;
  createdAt: string;
}
