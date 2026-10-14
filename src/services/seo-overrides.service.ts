import { query } from "../config/db";
import { AppError, badRequest, notFound } from "../utils/errors";
import { getPrimarySiteForTenant } from "./site.service";
import { getAudit } from "./seo-audit.service";
import type { FixPack } from "./seo-fixes.service";

export interface SeoOverride {
  title?: string;
  description?: string;
  canonical?: string;
  lang?: string;
  jsonLd?: Record<string, unknown>;
  alts?: Array<{ src: string; alt: string }>;
}

export interface StoredOverride {
  path: string;
  pageUrl: string;
  data: SeoOverride;
  updatedAt: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function pathOf(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function overrideFromPack(pack: FixPack): SeoOverride {
  const out: SeoOverride = {};
  for (const item of pack.items) {
    const d = item.data ?? {};
    if (item.id === "title") out.title = str(d.title, 70);
    if (item.id === "description") out.description = str(d.description, 170);
    if (item.id === "canonical") out.canonical = str(d.canonical, 300);
    if (item.id === "lang") out.lang = str(d.lang, 12);
    if (item.id === "schema" && d.jsonLd && typeof d.jsonLd === "object") {
      const text = JSON.stringify(d.jsonLd);
      if (text.length <= 6000) out.jsonLd = d.jsonLd as Record<string, unknown>;
    }
    if (item.id === "alt" && Array.isArray(d.alts)) {
      out.alts = (d.alts as Array<{ src?: unknown; alt?: unknown }>)
        .map((a) => ({ src: str(a.src, 300) ?? "", alt: str(a.alt, 125) ?? "" }))
        .filter((a) => a.src && a.alt)
        .slice(0, 20);
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as SeoOverride;
}

export async function applyFromAudit(tenantId: string, auditId: string, pageUrl: string): Promise<StoredOverride> {
  const audit = await getAudit(tenantId, auditId);
  if (!audit) throw notFound();
  const pack = (audit.fixes?.[pageUrl] ?? null) as FixPack | null;
  if (!pack) throw new AppError(409, "fixes_not_written");

  const data = overrideFromPack(pack);
  if (Object.keys(data).length === 0) throw badRequest("nothing_to_apply");

  const site = await getPrimarySiteForTenant(tenantId);
  if (!site) throw notFound("site_not_found");
  const path = pathOf(pageUrl);
  const rows = await query<{ updated_at: string }>(
    `insert into seo_overrides (site_id, tenant_id, path, page_url, data, updated_at) values ($1, $2, $3, $4, $5::jsonb, now())
     on conflict (site_id, path) do update set data = excluded.data, page_url = excluded.page_url, updated_at = now()
     returning updated_at`,
    [site.id, tenantId, path, pageUrl, JSON.stringify(data)]
  );
  return { path, pageUrl, data, updatedAt: rows[0].updated_at };
}

export async function listOverrides(tenantId: string): Promise<StoredOverride[]> {
  const rows = await query<{ path: string; page_url: string; data: SeoOverride; updated_at: string }>(
    `select path, page_url, data, updated_at from seo_overrides where tenant_id = $1 order by updated_at desc`,
    [tenantId]
  );
  return rows.map((r) => ({ path: r.path, pageUrl: r.page_url, data: r.data, updatedAt: r.updated_at }));
}

export async function removeOverride(tenantId: string, path: string): Promise<boolean> {
  const rows = await query(`delete from seo_overrides where tenant_id = $1 and path = $2 returning path`, [tenantId, path]);
  return rows.length > 0;
}

export async function overrideForPublicPath(siteId: string, rawPath: string): Promise<SeoOverride | null> {
  const path = rawPath.replace(/\/+$/, "") || "/";
  const rows = await query<{ data: SeoOverride }>(`select data from seo_overrides where site_id = $1 and path = $2`, [siteId, path.slice(0, 300)]);
  return rows[0]?.data ?? null;
}
