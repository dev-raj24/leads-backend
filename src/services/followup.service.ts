// services/followup.service.ts — raw SQL for the follow-up schedule.
import { query } from "../config/db";
import type { Followup } from "../types";

interface FollowupRow {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_contact: string;
  run_at: string;
  status: Followup["status"];
  template: string | null;
}

/** A tenant's follow-ups, soonest first (pending ones before finished ones). */
export async function getFollowupsForTenant(tenantId: string): Promise<Followup[]> {
  const rows = await query<FollowupRow>(
    `select f.id, f.lead_id, l.name as lead_name, l.contact as lead_contact,
            f.run_at, f.status, f.template
     from followups f
     join leads l on l.id = f.lead_id
     where l.tenant_id = $1
     order by (f.status = 'pending') desc, f.run_at asc`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    leadName: r.lead_name ?? r.lead_contact,
    runAt: r.run_at,
    status: r.status,
    template: r.template,
  }));
}
