// services/site.service.ts — raw SQL for the `sites` resource.

import { query } from "../config/db";
import type { Site } from "../types";

export interface SiteRow {
  id: string;
  tenant_id: string;
  domain: string | null;
  api_key: string;
  public_slug: string | null;
  settings: Record<string, unknown>;
  created_at: string;
}

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    apiKey: row.api_key,
    publicSlug: row.public_slug,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

/** A tenant's primary site — the widget/embed snippet uses its api_key. */
export async function getPrimarySiteForTenant(tenantId: string): Promise<Site | null> {
  const rows = await query<SiteRow>(
    `select * from sites where tenant_id = $1 order by created_at asc limit 1`,
    [tenantId]
  );
  return rows[0] ? toSite(rows[0]) : null;
}

/** Resolve a site from its public api_key — how every public/embed endpoint identifies the tenant. */
export async function getSiteByApiKey(apiKey: string): Promise<Site | null> {
  const rows = await query<SiteRow>(`select * from sites where api_key = $1 limit 1`, [apiKey]);
  return rows[0] ? toSite(rows[0]) : null;
}

export async function updateSiteSettings(
  tenantId: string,
  siteId: string,
  settings: Record<string, unknown>
): Promise<Site | null> {
  const rows = await query<SiteRow>(
    `update sites set settings = $3::jsonb
     where id = $2 and tenant_id = $1
     returning *`,
    [tenantId, siteId, JSON.stringify(settings)]
  );
  return rows[0] ? toSite(rows[0]) : null;
}

export function newPublicSlug(businessName: string): string {
  const base = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  return `${base}-${Math.random().toString(16).slice(2, 6)}`;
}

export interface LeadField {
  name: string;
  required: boolean;
  options: string[];
}

export function normalizeLeadFields(raw: unknown): LeadField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LeadField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const options = Array.isArray(r.options)
      ? Array.from(new Set(r.options.filter((o): o is string => typeof o === "string").map((o) => o.trim().slice(0, 40)).filter(Boolean))).slice(0, 12)
      : [];
    out.push({ name, required: r.required === true, options });
    if (out.length >= 12) break;
  }
  return out;
}
