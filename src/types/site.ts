export interface Site {
  id: string;
  tenantId: string;
  domain: string | null;
  apiKey: string;
  publicSlug: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
}
