// services/site.service.ts — raw SQL for the `sites` resource.

import { query } from "../config/db";
import type { Site } from "../types";

export interface SiteRow {
  id: string;
  tenant_id: string;
  domain: string | null;
  api_key: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    apiKey: row.api_key,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

/** A tenant's primary site — the widget/embed snippet uses its api_key. */
export async function getPrimarySiteForTenant(tenantId: string): Promise<Site | null> {
  const rows = await query<SiteRow>(
    `select * from sites where tenant_id = $1 order by created_at asc limit 1`,
    [tenantId]
  );
  return rows[0] ? toSite(rows[0]) : null;
}

/** Resolve a site from its public api_key — how every public/embed endpoint identifies the tenant. */
export async function getSiteByApiKey(apiKey: string): Promise<Site | null> {
  const rows = await query<SiteRow>(`select * from sites where api_key = $1 limit 1`, [apiKey]);
  return rows[0] ? toSite(rows[0]) : null;
}

export async function updateSiteSettings(
  tenantId: string,
  siteId: string,
  settings: Record<string, unknown>
): Promise<Site | null> {
  const rows = await query<SiteRow>(
    `update sites set settings = $3::jsonb
     where id = $2 and tenant_id = $1
     returning *`,
    [tenantId, siteId, JSON.stringify(settings)]
  );
  return rows[0] ? toSite(rows[0]) : null;
}

const SEEN_THROTTLE_MS = 60_000;
const lastSeenWrite = new Map<string, number>();

export function normalizeHost(value: string): string {
  const withoutScheme = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  return withoutScheme.split(/[/?#:]/)[0].replace(/^www\./, "");
}

export function normalizeDomainList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const hosts = raw
    .filter((v): v is string => typeof v === "string")
    .map(normalizeHost)
    .filter((h) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) && h.length <= 120);
  return Array.from(new Set(hosts)).slice(0, 20);
}

export function isHostAllowed(settings: Record<string, unknown>, host: string): boolean {
  const list = normalizeDomainList(settings.allowedDomains);
  if (list.length === 0) return true;
  const h = normalizeHost(host);
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

export async function recordSeen(siteId: string, host: string): Promise<void> {
  const cacheKey = `${siteId}:${host}`;
  const now = Date.now();
  if (now - (lastSeenWrite.get(cacheKey) ?? 0) < SEEN_THROTTLE_MS) return;
  lastSeenWrite.set(cacheKey, now);
  await query(`update sites set last_seen_at = now(), last_seen_host = $2 where id = $1`, [siteId, host]);
}

export async function recordBlocked(siteId: string, host: string, kind: string): Promise<void> {
  await query(
    `insert into blocked_events (site_id, host, kind)
     select $1, $2, $3
     where not exists (
       select 1 from blocked_events where site_id = $1 and host = $2 and kind = $3 and created_at > now() - interval '10 minutes'
     )`,
    [siteId, host, kind]
  );
}

export interface InstallStatus {
  installed: boolean;
  lastSeenAt: string | null;
  lastSeenHost: string | null;
  blocked: Array<{ host: string; kind: string; lastAt: string; count: number }>;
}

export async function getInstallStatus(tenantId: string, siteId: string): Promise<InstallStatus | null> {
  const sites = await query<{ last_seen_at: string | null; last_seen_host: string | null }>(
    `select last_seen_at, last_seen_host from sites where id = $2 and tenant_id = $1`,
    [tenantId, siteId]
  );
  if (!sites[0]) return null;
  const blocked = await query<{ host: string; kind: string; last_at: string; count: number }>(
    `select host, kind, max(created_at) as last_at, count(*)::int as count
     from blocked_events where site_id = $1 and created_at > now() - interval '14 days'
     group by host, kind order by max(created_at) desc limit 10`,
    [siteId]
  );
  const seen = sites[0].last_seen_at;
  return {
    installed: Boolean(seen),
    lastSeenAt: seen,
    lastSeenHost: sites[0].last_seen_host,
    blocked: blocked.map((b) => ({ host: b.host, kind: b.kind, lastAt: b.last_at, count: b.count })),
  };
}
