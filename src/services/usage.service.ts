import { query } from "../config/db";
import { planDef } from "../config/plans";
import { getTenant } from "./tenant.service";

export interface Usage {
  plan: string;
  leadsThisMonth: number;
  leadsLimit: number;
  overLimit: boolean;
  nearLimit: boolean;
}

const MONTH_START = `date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`;

export async function getUsage(tenantId: string): Promise<Usage> {
  const [tenant, rows] = await Promise.all([
    getTenant(tenantId),
    query<{ count: number }>(
      `select count(*)::int as count from leads where tenant_id = $1 and qualified = true and created_at >= ${MONTH_START}`,
      [tenantId]
    ),
  ]);
  const def = planDef(tenant.plan);
  const used = rows[0]?.count ?? 0;
  return {
    plan: def.id,
    leadsThisMonth: used,
    leadsLimit: def.leadsPerMonth,
    overLimit: used > def.leadsPerMonth,
    nearLimit: used >= Math.floor(def.leadsPerMonth * 0.8),
  };
}

/** Leads are always saved and shown; only paid automations pause once a plan's monthly allowance is exceeded. */
export async function automationsAllowed(tenantId: string): Promise<boolean> {
  return !(await getUsage(tenantId)).overLimit;
}
