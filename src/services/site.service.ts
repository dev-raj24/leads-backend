// services/site.service.ts — raw SQL for the `sites` resource.

import { query } from "../config/db";
import type { Site } from "../types";

export interface SiteRow {
  id: string;
  tenant_id: string;
  domain: string | null;
  api_key: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    apiKey: row.api_key,
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
