// services/customer.service.ts — customers are a computed view over leads,
// grouped by contact (case-insensitive). No separate table: every unique
// contact that has ever enquired is a customer record; wonCount > 0 marks
// them as converted (isCustomer), otherwise they're still just a prospect.

import { query } from "../config/db";
import type { CustomerSummary } from "../types";
import { normalizeContact } from "../utils/contact";

interface CustomerRow {
  contact: string;
  name: string | null;
  lead_count: number;
  won_count: number;
  last_source: string;
  first_seen_at: string;
  last_activity_at: string;
}

const AGGREGATE_SELECT = `
  select
    (array_agg(contact order by created_at desc))[1] as contact,
    (array_agg(name order by created_at desc) filter (where name is not null))[1] as name,
    count(*)::int as lead_count,
    count(*) filter (where status = 'won')::int as won_count,
    (array_agg(source order by created_at desc))[1] as last_source,
    min(created_at) as first_seen_at,
    max(last_activity_at) as last_activity_at
  from leads
`;

function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    contact: row.contact,
    name: row.name,
    leadCount: row.lead_count,
    wonCount: row.won_count,
    isCustomer: row.won_count > 0,
    lastSource: row.last_source,
    firstSeenAt: row.first_seen_at,
    lastActivityAt: row.last_activity_at,
  };
}

export async function getCustomersForTenant(tenantId: string): Promise<CustomerSummary[]> {
  const rows = await query<CustomerRow>(
    `${AGGREGATE_SELECT}
     where tenant_id = $1 and qualified = true
     group by contact_key
     order by max(last_activity_at) desc`,
    [tenantId]
  );
  return rows.map(toCustomerSummary);
}

export async function getCustomerSummary(tenantId: string, contact: string): Promise<CustomerSummary | null> {
  const rows = await query<CustomerRow>(
    `${AGGREGATE_SELECT}
     where tenant_id = $1 and qualified = true and contact_key = $2
     group by contact_key`,
    [tenantId, normalizeContact(contact).key]
  );
  return rows[0] ? toCustomerSummary(rows[0]) : null;
}
