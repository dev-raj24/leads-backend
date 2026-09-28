import { query } from "../config/db";
import type { BusinessProfile, ServiceItem } from "../types";

type TextField = "about" | "timings" | "tone" | "faqs";

const TEXT_FIELD_LIMITS: Record<TextField, number> = {
  about: 3000,
  timings: 500,
  tone: 200,
  faqs: 4000,
};

export const TEXT_FIELDS = Object.keys(TEXT_FIELD_LIMITS) as TextField[];
export const textFieldLimit = (field: TextField) => TEXT_FIELD_LIMITS[field];

export const SERVICE_LIMITS = { name: 100, description: 300, price: 50, maxItems: 30 };

const EMPTY: BusinessProfile = { about: "", services: [], timings: "", tone: "", faqs: "" };

interface ProfileRow {
  business_info: (Partial<Record<TextField, unknown>> & { services?: unknown }) | null;
  business_name: string;
}

function readServices(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      price: typeof item.price === "string" ? item.price : "",
      hidePrice: item.hidePrice === true,
    }))
    .filter((s) => s.name.trim().length > 0);
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
  for (const field of TEXT_FIELDS) {
    if (typeof info[field] === "string") profile[field] = info[field] as string;
  }
  profile.services = readServices(info.services);
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
