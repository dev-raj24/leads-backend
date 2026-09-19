// services/lead.service.ts — business logic + RAW SQL.
// Rule: raw SQL lives ONLY here. Every query is parametrized ($1, $2 ...)
// and every leads query is scoped by tenant_id.

import { query } from "../config/db";
import { InvalidSiteKeyError } from "../utils/errors";
import type { IngestLeadInput, Lead, LeadStatus } from "../types";

interface SiteRow {
  id: string;
  tenant_id: string;
}

interface LeadRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  name: string | null;
  contact: string;
  message: string | null;
  source: string;
  status: string;
  score: number;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  last_activity_at: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    name: row.name,
    contact: row.contact,
    message: row.message,
    source: row.source as Lead["source"],
    status: row.status as LeadStatus,
    score: row.score,
    customFields: row.custom_fields ?? undefined,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

/**
 * A lead lands from a client's existing static site: the widget.js snippet
 * (or a swapped form action) POSTs here with the site's api_key. We resolve
 * the key to a tenant, insert a tenant-tagged lead, and log the event that
 * downstream jobs (alerts, AI auto-reply) react to.
 */
export async function createFromSite(input: IngestLeadInput): Promise<Lead> {
  // 1. GET — resolve site_key -> tenant (never trust a client-supplied tenant id)
  const sites = await query<SiteRow>(
    `select id, tenant_id from sites where api_key = $1 limit 1`,
    [input.siteKey]
  );
  const site = sites[0];
  if (!site) throw new InvalidSiteKeyError();

  // 2. USE — insert the lead, tenant-tagged
  const rows = await query<LeadRow>(
    `insert into leads (tenant_id, site_id, name, contact, message, source, status)
     values ($1, $2, $3, $4, $5, 'form', 'new')
     returning *`,
    [site.tenant_id, site.id, input.name ?? null, input.contact, input.message ?? null]
  );
  const lead = toLead(rows[0]);

  // 3. audit trail — alerts / AI auto-reply jobs subscribe to this event
  await query(
    `insert into lead_events (lead_id, type, payload) values ($1, 'created', $2::jsonb)`,
    [lead.id, JSON.stringify({ source: "form", siteId: site.id })]
  );

  return lead;
}

export async function getLeadsForTenant(tenantId: string, status?: LeadStatus): Promise<Lead[]> {
  const rows = status
    ? await query<LeadRow>(
        `select * from leads where tenant_id = $1 and status = $2 order by created_at desc`,
        [tenantId, status]
      )
    : await query<LeadRow>(
        `select * from leads where tenant_id = $1 order by created_at desc`,
        [tenantId]
      );
  return rows.map(toLead);
}

export async function getLeadById(tenantId: string, leadId: string): Promise<Lead | null> {
  const rows = await query<LeadRow>(
    `select * from leads where id = $2 and tenant_id = $1 limit 1`,
    [tenantId, leadId]
  );
  return rows[0] ? toLead(rows[0]) : null;
}

export async function updateLeadStatus(
  tenantId: string,
  leadId: string,
  status: LeadStatus
): Promise<Lead | null> {
  const rows = await query<LeadRow>(
    `update leads set status = $3, last_activity_at = now()
     where id = $2 and tenant_id = $1
     returning *`,
    [tenantId, leadId, status]
  );
  if (!rows[0]) return null;

  await query(
    `insert into lead_events (lead_id, type, payload) values ($1, 'status_changed', $2::jsonb)`,
    [leadId, JSON.stringify({ status })]
  );

  return toLead(rows[0]);
}

export async function bulkCreateLeads(
  tenantId: string,
  siteId: string | null,
  leads: Array<{ name?: string; contact: string; message?: string; source: string; customFields?: Record<string, unknown> }>
): Promise<Lead[]> {
  if (leads.length === 0) return [];

  // Construct parameter list: ($1, $2, $3, $4, $5, $6, $7), ($8, $9, ...)
  const values: any[] = [];
  const placeholders: string[] = [];
  
  let i = 1;
  for (const lead of leads) {
    placeholders.push(`($${i}, $${i+1}, $${i+2}, $${i+3}, $${i+4}, $${i+5}, 'new', $${i+6})`);
    values.push(
      tenantId,
      siteId,
      lead.name ?? null,
      lead.contact,
      lead.message ?? null,
      lead.source,
      lead.customFields ? JSON.stringify(lead.customFields) : null
    );
    i += 7;
  }

  const queryStr = `
    insert into leads (tenant_id, site_id, name, contact, message, source, status, custom_fields)
    values ${placeholders.join(", ")}
    returning *
  `;

  const rows = await query<LeadRow>(queryStr, values);
  
  // Create audit events
  if (rows.length > 0) {
    const eventValues: any[] = [];
    const eventPlaceholders: string[] = [];
    let j = 1;
    for (const row of rows) {
      eventPlaceholders.push(`($${j}, 'created', $${j+1}::jsonb)`);
      eventValues.push(row.id, JSON.stringify({ source: row.source, siteId: row.site_id, bulk: true }));
      j += 2;
    }
    await query(`insert into lead_events (lead_id, type, payload) values ${eventPlaceholders.join(", ")}`, eventValues);
  }

  return rows.map(toLead);
}
