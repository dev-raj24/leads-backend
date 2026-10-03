// services/lead.service.ts — business logic + RAW SQL.
// Rule: raw SQL lives ONLY here. Every query is parametrized ($1, $2 ...)
// and every leads query is scoped by tenant_id.

import { query } from "../config/db";
import { normalizeContact } from "../utils/contact";
import { InvalidSiteKeyError } from "../utils/errors";
import type { IngestLeadInput, Lead, LeadStatus } from "../types";

interface SiteRow {
  id: string;
  tenant_id: string;
  settings: Record<string, unknown> | null;
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
  qualified: boolean;
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
    qualified: row.qualified,
    customFields: row.custom_fields ?? undefined,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

export interface IngestResult {
  lead: Lead;
  tenantId: string;
  siteId: string;
  siteSettings: Record<string, unknown>;
  duplicate: boolean;
}

const DUPLICATE_WINDOW_SECONDS = 60;

export async function createFromSite(input: IngestLeadInput & { qualified?: boolean }): Promise<IngestResult> {
  const sites = await query<SiteRow>(
    `select id, tenant_id, settings from sites where api_key = $1 limit 1`,
    [input.siteKey]
  );
  const site = sites[0];
  if (!site) throw new InvalidSiteKeyError();

  const source = input.source ?? "form";
  const qualified = input.qualified ?? true;
  const { contact, key } = normalizeContact(input.contact);

  const recent = await query<LeadRow>(
    `select * from leads
     where tenant_id = $1 and contact_key = $2 and source = $3
       and message is not distinct from $4
       and created_at >= now() - make_interval(secs => $5)
     order by created_at desc limit 1`,
    [site.tenant_id, key, source, input.message ?? null, DUPLICATE_WINDOW_SECONDS]
  );
  if (recent[0]) {
    return { lead: toLead(recent[0]), tenantId: site.tenant_id, siteId: site.id, siteSettings: site.settings ?? {}, duplicate: true };
  }

  const rows = await query<LeadRow>(
    `insert into leads (tenant_id, site_id, name, contact, contact_key, message, source, status, qualified, custom_fields)
     values ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $9::jsonb)
     returning *`,
    [
      site.tenant_id,
      site.id,
      input.name ?? null,
      contact,
      key,
      input.message ?? null,
      source,
      qualified,
      input.customFields ? JSON.stringify(input.customFields) : null,
    ]
  );
  const lead = toLead(rows[0]);

  await recordEvent(lead.id, "created", { source, siteId: site.id });
  if (lead.message) {
    const channel = source === "chat_widget" ? "chat" : source === "whatsapp" ? "whatsapp" : "form";
    await query(
      `insert into messages (lead_id, channel, direction, body) values ($1, $2, 'inbound', $3)`,
      [lead.id, channel, lead.message]
    );
  }

  return { lead, tenantId: site.tenant_id, siteId: site.id, siteSettings: site.settings ?? {}, duplicate: false };
}

export async function promoteToLead(tenantId: string, leadId: string, rawContact: string): Promise<Lead | null> {
  const { contact, key } = normalizeContact(rawContact);
  const rows = await query<LeadRow>(
    `update leads set contact = $3, contact_key = $4, qualified = true, last_activity_at = now()
     where id = $2 and tenant_id = $1 and qualified = false
     returning *`,
    [tenantId, leadId, contact, key]
  );
  if (!rows[0]) return null;
  await recordEvent(leadId, "became_lead", { contact });
  return toLead(rows[0]);
}

export async function recordEvent(leadId: string, type: string, payload: Record<string, unknown> = {}) {
  await query(`insert into lead_events (lead_id, type, payload) values ($1, $2, $3::jsonb)`, [leadId, type, JSON.stringify(payload)]);
}

export interface LeadEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function getEventsForLead(tenantId: string, leadId: string): Promise<LeadEvent[]> {
  const rows = await query<{ id: string; type: string; payload: Record<string, unknown>; created_at: string }>(
    `select e.id, e.type, e.payload, e.created_at from lead_events e
     join leads l on l.id = e.lead_id
     where e.lead_id = $2 and l.tenant_id = $1
     order by e.created_at asc`,
    [tenantId, leadId]
  );
  return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload ?? {}, createdAt: r.created_at }));
}

export async function getRecentLeads(tenantId: string, limit: number): Promise<Lead[]> {
  const rows = await query<LeadRow>(
    `select * from leads where tenant_id = $1 and qualified = true order by created_at desc limit $2`,
    [tenantId, limit]
  );
  return rows.map(toLead);
}

export async function countLeadsByStatus(tenantId: string): Promise<Record<string, number>> {
  const rows = await query<{ status: string; count: string }>(
    `select status, count(*)::text as count from leads where tenant_id = $1 and qualified = true group by status`,
    [tenantId]
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}

export async function getLeadsForTenant(tenantId: string, status?: LeadStatus): Promise<Lead[]> {
  const rows = status
    ? await query<LeadRow>(
        `select * from leads where tenant_id = $1 and qualified = true and status = $2 order by created_at desc`,
        [tenantId, status]
      )
    : await query<LeadRow>(
        `select * from leads where tenant_id = $1 and qualified = true order by created_at desc`,
        [tenantId]
      );
  return rows.map(toLead);
}

export async function getLeadsForContact(tenantId: string, contact: string): Promise<Lead[]> {
  const rows = await query<LeadRow>(
    `select * from leads where tenant_id = $1 and qualified = true and contact_key = $2 order by created_at desc`,
    [tenantId, normalizeContact(contact).key]
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
    placeholders.push(`($${i}, $${i+1}, $${i+2}, $${i+3}, $${i+4}, $${i+5}, $${i+6}, 'new', $${i+7})`);
    const normalized = normalizeContact(lead.contact);
    values.push(
      tenantId,
      siteId,
      lead.name ?? null,
      normalized.contact,
      normalized.key,
      lead.message ?? null,
      lead.source,
      lead.customFields ? JSON.stringify(lead.customFields) : null
    );
    i += 8;
  }

  const queryStr = `
    insert into leads (tenant_id, site_id, name, contact, contact_key, message, source, status, custom_fields)
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
