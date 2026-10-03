import { query } from "../config/db";
import type { StatsOverview } from "../types";

export async function isValidTimezone(tz: string): Promise<boolean> {
  const rows = await query<{ ok: number }>(`select 1 as ok from pg_timezone_names where name = $1 limit 1`, [tz]);
  return rows.length > 0;
}

export async function getOverview(tenantId: string, days: number, tz: string): Promise<StatsOverview> {
  const [statusRows, sourceRows, windowRows, dailyRows, followupRows, aiRows, replyRows] = await Promise.all([
    query<{ status: string; count: number }>(
      `select status, count(*)::int as count from leads where tenant_id = $1 and qualified = true group by status`,
      [tenantId]
    ),
    query<{ source: string; count: number }>(
      `select source, count(*)::int as count from leads where tenant_id = $1 and qualified = true group by source order by count desc`,
      [tenantId]
    ),
    query<{ today: number; last7: number; prev7: number }>(
      `select
         count(*) filter (where created_at >= (date_trunc('day', now() at time zone $2) at time zone $2))::int as today,
         count(*) filter (where created_at >= now() - interval '7 days')::int as last7,
         count(*) filter (where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days')::int as prev7
       from leads where tenant_id = $1 and qualified = true`,
      [tenantId, tz]
    ),
    query<{ date: string; leads: number; won: number }>(
      `with days as (
         select generate_series(
           (date_trunc('day', now() at time zone $2) - make_interval(days => $3 - 1))::date,
           (now() at time zone $2)::date,
           interval '1 day'
         )::date as d
       )
       select to_char(days.d, 'YYYY-MM-DD') as date,
              count(l.id)::int as leads,
              (count(l.id) filter (where l.status = 'won'))::int as won
       from days
       left join leads l on l.tenant_id = $1 and l.qualified = true and (l.created_at at time zone $2)::date = days.d
       group by days.d
       order by days.d`,
      [tenantId, tz, days]
    ),
    query<{ count: number }>(
      `select count(*)::int as count from followups f
       join leads l on l.id = f.lead_id
       where l.tenant_id = $1 and f.status in ('pending', 'approved', 'manual')`,
      [tenantId]
    ),
    query<{ count: number }>(
      `select count(*)::int as count from messages m
       join leads l on l.id = m.lead_id
       where l.tenant_id = $1 and m.ai_generated = true and m.direction = 'outbound'
         and m.created_at >= now() - interval '30 days'`,
      [tenantId]
    ),
    query<{ secs: number | null }>(
      `select avg(extract(epoch from (m.first_out - l.created_at)))::float as secs
       from leads l
       join lateral (
         select min(created_at) as first_out from messages where lead_id = l.id and direction = 'outbound'
       ) m on m.first_out is not null
       where l.tenant_id = $1 and l.qualified = true and l.created_at >= now() - interval '30 days'`,
      [tenantId]
    ),
  ]);

  const byStatus = statusRows.map((r) => ({ status: r.status, count: r.count }));
  const count = (status: string) => byStatus.find((r) => r.status === status)?.count ?? 0;
  const total = byStatus.reduce((sum, r) => sum + r.count, 0);
  const win = windowRows[0];

  return {
    totals: {
      leads: total,
      today: win?.today ?? 0,
      last7Days: win?.last7 ?? 0,
      previous7Days: win?.prev7 ?? 0,
      won: count("won"),
      waiting: count("new"),
    },
    conversionRate: total === 0 ? 0 : count("won") / total,
    avgFirstReplySeconds: replyRows[0]?.secs ?? null,
    aiReplies: aiRows[0]?.count ?? 0,
    followupsOpen: followupRows[0]?.count ?? 0,
    daily: dailyRows,
    byStatus,
    bySource: sourceRows.map((r) => ({ source: r.source, count: r.count })),
  };
}
