import { query } from "../config/db";
import { notFound } from "../utils/errors";
import type { DueFollowup, Followup, FollowupLead, FollowupStatus } from "../types";

const DEFAULT_DELAY_HOURS = 48;

interface FollowupRow {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_contact: string;
  run_at: string;
  status: FollowupStatus;
  template: string | null;
  channel: string | null;
  sent_at: string | null;
}

const toFollowup = (r: FollowupRow): Followup => ({
  id: r.id,
  leadId: r.lead_id,
  leadName: r.lead_name ?? r.lead_contact,
  leadContact: r.lead_contact,
  runAt: r.run_at,
  status: r.status,
  template: r.template,
  channel: r.channel,
  sentAt: r.sent_at,
});

const SELECT = `select f.id, f.lead_id, l.name as lead_name, l.contact as lead_contact,
                       f.run_at, f.status, f.template, f.channel, f.sent_at
                from followups f
                join leads l on l.id = f.lead_id`;

export async function getFollowupsForTenant(tenantId: string): Promise<Followup[]> {
  const rows = await query<FollowupRow>(
    `${SELECT}
     where l.tenant_id = $1
     order by (f.status in ('pending', 'approved', 'manual', 'processing')) desc, f.run_at asc`,
    [tenantId]
  );
  return rows.map(toFollowup);
}

async function getOne(tenantId: string, id: string): Promise<Followup> {
  const rows = await query<FollowupRow>(`${SELECT} where f.id = $2 and l.tenant_id = $1`, [tenantId, id]);
  if (!rows[0]) throw notFound();
  return toFollowup(rows[0]);
}

export async function scheduleDefaultFollowup(leadId: string): Promise<void> {
  await query(
    `insert into followups (lead_id, run_at, status)
     select $1, now() + make_interval(hours => $2), 'pending'
     where not exists (select 1 from followups where lead_id = $1 and status in ('pending', 'approved'))`,
    [leadId, DEFAULT_DELAY_HOURS]
  );
}

export async function createFollowup(tenantId: string, leadId: string, runAt: Date, template?: string): Promise<Followup> {
  const leads = await query<{ id: string }>(`select id from leads where id = $2 and tenant_id = $1`, [tenantId, leadId]);
  if (!leads[0]) throw notFound();

  const rows = await query<{ id: string }>(
    `insert into followups (lead_id, run_at, status, template) values ($1, $2, 'pending', $3) returning id`,
    [leadId, runAt.toISOString(), template ?? null]
  );
  return getOne(tenantId, rows[0].id);
}

async function transition(
  tenantId: string,
  id: string,
  from: FollowupStatus[],
  set: string,
  extra: unknown[] = []
): Promise<Followup> {
  const rows = await query<{ id: string }>(
    `update followups f set ${set}
     from leads l
     where f.id = $2 and f.lead_id = l.id and l.tenant_id = $1 and f.status = any($3::text[])
     returning f.id`,
    [tenantId, id, from, ...extra]
  );
  if (!rows[0]) throw notFound();
  return getOne(tenantId, id);
}

export const approveFollowup = (tenantId: string, id: string, template?: string) =>
  transition(tenantId, id, ["pending"], `status = 'approved', approved_at = now(), template = coalesce($4, f.template)`, [template ?? null]);

export const cancelFollowup = (tenantId: string, id: string) =>
  transition(tenantId, id, ["pending", "approved", "manual"], `status = 'cancelled'`);

export const markFollowupSent = (tenantId: string, id: string) =>
  transition(tenantId, id, ["manual"], `status = 'sent', sent_at = now()`);

export async function claimDueFollowups(limit: number): Promise<DueFollowup[]> {
  const rows = await query<{ id: string; lead_id: string; template: string | null }>(
    `update followups f set status = 'processing'
     where f.id in (
       select f2.id from followups f2
       join leads l on l.id = f2.lead_id
       left join lateral (
         select s.settings from sites s where s.tenant_id = l.tenant_id order by s.created_at asc limit 1
       ) st on true
       where f2.run_at <= now()
         and (f2.status = 'approved'
              or (f2.status = 'pending' and coalesce(st.settings ->> 'autofollow', 'false') = 'true'))
       order by f2.run_at asc
       limit $1
       for update of f2 skip locked
     )
     returning f.id, f.lead_id, f.template`,
    [limit]
  );
  return rows.map((r) => ({ id: r.id, leadId: r.lead_id, template: r.template }));
}

export async function finishFollowup(
  id: string,
  status: FollowupStatus,
  details: { template?: string; channel?: string } = {}
): Promise<void> {
  await query(
    `update followups
     set status = $2,
         template = coalesce($3, template),
         channel = coalesce($4, channel),
         sent_at = case when $2 = 'sent' then now() else sent_at end
     where id = $1`,
    [id, status, details.template ?? null, details.channel ?? null]
  );
}

export async function getLeadForFollowup(leadId: string): Promise<FollowupLead | null> {
  const rows = await query<{ id: string; tenant_id: string; name: string | null; contact: string; message: string | null; status: string; source: string }>(
    `select id, tenant_id, name, contact, message, status, source from leads where id = $1`,
    [leadId]
  );
  const r = rows[0];
  return r ? { id: r.id, tenantId: r.tenant_id, name: r.name, contact: r.contact, message: r.message, status: r.status, source: r.source } : null;
}

export async function releaseStuckFollowups(minutes: number): Promise<void> {
  await query(
    `update followups set status = 'manual' where status = 'processing' and run_at < now() - make_interval(mins => $1)`,
    [minutes]
  );
}
