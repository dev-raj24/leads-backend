export interface Site {
  id: string;
  tenantId: string;
  domain: string | null;
  apiKey: string;
  settings: Record<string, unknown>;
  createdAt: string;
}
