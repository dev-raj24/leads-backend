import { query } from "../config/db";
import { notFound } from "../utils/errors";
import type { Plan, Tenant } from "../types";

interface TenantRow {
  id: string;
  name: string;
  plan: string;
  industry: string | null;
  onboarding_completed: boolean;
  plan_status: string;
  plan_renews_at: string | null;
  razorpay_subscription_id: string | null;
  created_at: string;
}

const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  plan: row.plan,
  industry: row.industry,
  onboardingCompleted: row.onboarding_completed,
  planStatus: row.plan_status,
  planRenewsAt: row.plan_renews_at,
  createdAt: row.created_at,
});

export async function getTenant(tenantId: string): Promise<Tenant> {
  const rows = await query<TenantRow>(`select * from tenants where id = $1`, [tenantId]);
  if (!rows[0]) throw notFound("tenant_not_found");
  return toTenant(rows[0]);
}

export async function setName(tenantId: string, name: string): Promise<Tenant> {
  const rows = await query<TenantRow>(
    `update tenants set name = $2 where id = $1 returning *`,
    [tenantId, name]
  );
  if (!rows[0]) throw notFound("tenant_not_found");
  return toTenant(rows[0]);
}

export async function setIndustry(tenantId: string, industry: string): Promise<Tenant> {
  const rows = await query<TenantRow>(
    `update tenants set industry = $2 where id = $1 returning *`,
    [tenantId, industry]
  );
  if (!rows[0]) throw notFound("tenant_not_found");
  return toTenant(rows[0]);
}

export async function choosePlan(tenantId: string, plan: Plan): Promise<Tenant> {
  const rows = await query<TenantRow>(
    `update tenants set plan = $2, onboarding_completed = true where id = $1 returning *`,
    [tenantId, plan]
  );
  if (!rows[0]) throw notFound("tenant_not_found");
  return toTenant(rows[0]);
}
