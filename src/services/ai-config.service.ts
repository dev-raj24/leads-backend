import { query } from "../config/db";
import type { BusinessProfile } from "../types";

const FIELD_LIMITS: Record<keyof BusinessProfile, number> = {
  about: 3000,
  services: 3000,
  timings: 500,
  tone: 200,
  faqs: 4000,
};

export const PROFILE_FIELDS = Object.keys(FIELD_LIMITS) as Array<keyof BusinessProfile>;
export const profileFieldLimit = (field: keyof BusinessProfile) => FIELD_LIMITS[field];

const EMPTY: BusinessProfile = { about: "", services: "", timings: "", tone: "", faqs: "" };

interface ProfileRow {
  business_info: Partial<Record<keyof BusinessProfile, unknown>> | null;
  business_name: string;
}

export async function getBusinessProfile(tenantId: string): Promise<{ businessName: string; profile: BusinessProfile }> {
  const rows = await query<ProfileRow>(
    `select t.name as business_name, c.business_info
     from tenants t
     left join ai_config c on c.tenant_id = t.id
     where t.id = $1`,
    [tenantId]
  );
  const row = rows[0];
  const info = row?.business_info ?? {};
  const profile = { ...EMPTY };
  for (const field of PROFILE_FIELDS) {
    if (typeof info[field] === "string") profile[field] = info[field] as string;
  }
  return { businessName: row?.business_name ?? "", profile };
}

export async function saveBusinessProfile(tenantId: string, profile: BusinessProfile): Promise<BusinessProfile> {
  await query(
    `insert into ai_config (tenant_id, business_info) values ($1, $2::jsonb)
     on conflict (tenant_id) do update set business_info = excluded.business_info, updated_at = now()`,
    [tenantId, JSON.stringify(profile)]
  );
  return profile;
}
