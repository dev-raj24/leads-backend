import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { query } from "../config/db";
import { env } from "../config/env";
import { AppError, badRequest } from "../utils/errors";
import { open, seal } from "../utils/secretbox";

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"];
const STATE_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAY = 86_400_000;

export const requireConfigured = () => {
  if (!env.googleConfigured) throw new AppError(503, "google_not_configured", "Google sign-in is not set up on this server.");
};

const redirectUri = () => `${env.publicApiUrl}/api/public/google/callback`;

const sign = (payload: string) => createHmac("sha256", env.jwtSecret).update(`gsc-state:${payload}`).digest("base64url");

function makeState(tenantId: string): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, n: randomBytes(8).toString("hex"), e: Date.now() + STATE_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string): string | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { t?: string; e?: number };
    return data.t && data.e && data.e > Date.now() ? data.t : null;
  } catch {
    return null;
  }
}

export function consentUrl(tenantId: string): string {
  requireConfigured();
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: makeState(tenantId),
  });
  return `${env.google.authBase}?${params.toString()}`;
}

async function googleJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const revoked = body?.error === "invalid_grant" || res.status === 401;
    throw new AppError(revoked ? 409 : 502, revoked ? "google_access_revoked" : "google_request_failed", body?.error_description ?? body?.error?.message);
  }
  return body as T;
}

const tokenForm = (fields: Record<string, string>) =>
  ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }) satisfies RequestInit;

export async function completeConnection(code: string, state: string): Promise<string> {
  requireConfigured();
  const tenantId = readState(state);
  if (!tenantId) throw badRequest("invalid_state");

  const tokens = await googleJson<{ access_token: string; refresh_token?: string }>(
    `${env.google.tokenBase}/token`,
    tokenForm({ code, client_id: env.google.clientId, client_secret: env.google.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" })
  );
  if (!tokens.refresh_token) throw new AppError(502, "google_no_refresh_token");

  const info = await googleJson<{ email?: string }>(`${env.google.apiBase}/oauth2/v2/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } }).catch(() => ({ email: undefined }));

  await query(
    `insert into search_console_connections (tenant_id, google_email, refresh_token_enc, property, connected_at, last_error)
     values ($1, $2, $3, null, now(), null)
     on conflict (tenant_id) do update
       set google_email = excluded.google_email, refresh_token_enc = excluded.refresh_token_enc, property = null, connected_at = now(), last_error = null`,
    [tenantId, info.email ?? null, seal(tokens.refresh_token)]
  );
  accessCache.delete(tenantId);
  return tenantId;
}

interface Connection {
  google_email: string | null;
  refresh_token_enc: string;
  property: string | null;
  connected_at: string;
  last_error: string | null;
}

const getConnection = async (tenantId: string): Promise<Connection | null> => {
  const rows = await query<Connection>(`select * from search_console_connections where tenant_id = $1`, [tenantId]);
  return rows[0] ?? null;
};

const accessCache = new Map<string, { token: string; until: number }>();

async function accessToken(tenantId: string, conn: Connection): Promise<string> {
  const hit = accessCache.get(tenantId);
  if (hit && hit.until > Date.now() + 30_000) return hit.token;
  try {
    const res = await googleJson<{ access_token: string; expires_in?: number }>(
      `${env.google.tokenBase}/token`,
      tokenForm({ client_id: env.google.clientId, client_secret: env.google.clientSecret, refresh_token: open(conn.refresh_token_enc), grant_type: "refresh_token" })
    );
    accessCache.set(tenantId, { token: res.access_token, until: Date.now() + (res.expires_in ?? 3000) * 1000 });
    return res.access_token;
  } catch (err) {
    if (err instanceof AppError && err.code === "google_access_revoked") {
      await query(`update search_console_connections set last_error = 'access_revoked' where tenant_id = $1`, [tenantId]);
    }
    throw err;
  }
}

export interface ScStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  property: string | null;
  needsReconnect: boolean;
}

export async function getStatus(tenantId: string): Promise<ScStatus> {
  const conn = await getConnection(tenantId);
  return {
    configured: env.googleConfigured,
    connected: Boolean(conn),
    email: conn?.google_email ?? null,
    property: conn?.property ?? null,
    needsReconnect: conn?.last_error === "access_revoked",
  };
}

export async function listProperties(tenantId: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const conn = await getConnection(tenantId);
  if (!conn) throw new AppError(409, "not_connected");
  const token = await accessToken(tenantId, conn);
  const data = await googleJson<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>(`${env.google.apiBase}/webmasters/v3/sites`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

export async function chooseProperty(tenantId: string, siteUrl: string): Promise<void> {
  const known = await listProperties(tenantId);
  if (!known.some((s) => s.siteUrl === siteUrl)) throw badRequest("unknown_property");
  await query(`update search_console_connections set property = $2 where tenant_id = $1`, [tenantId, siteUrl]);
  await query(`delete from search_console_snapshots where tenant_id = $1`, [tenantId]);
}

export async function disconnect(tenantId: string): Promise<void> {
  const conn = await getConnection(tenantId);
  if (conn && env.googleConfigured) {
    await fetch(`${env.google.tokenBase}/revoke`, tokenForm({ token: open(conn.refresh_token_enc) })).catch(() => undefined);
  }
  await query(`delete from search_console_connections where tenant_id = $1`, [tenantId]);
  accessCache.delete(tenantId);
}

interface Row {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Performance {
  property: string;
  rangeDays: number;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  daily: Array<{ date: string; clicks: number; impressions: number }>;
  queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  pages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function searchAnalytics(token: string, property: string, body: Record<string, unknown>): Promise<Row[]> {
  const data = await googleJson<{ rows?: Row[] }>(`${env.google.apiBase}/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.rows ?? [];
}

const totalsOf = (rows: Row[]) => {
  const r = rows[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position, 1) } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
};

export async function getPerformance(tenantId: string, rangeDays: number, force: boolean): Promise<Performance> {
  const conn = await getConnection(tenantId);
  if (!conn) throw new AppError(409, "not_connected");
  if (!conn.property) throw new AppError(409, "no_property_chosen");

  if (!force) {
    const cached = await query<{ data: Performance; fetched_at: string }>(
      `select data, fetched_at from search_console_snapshots where tenant_id = $1 and property = $2 and range_days = $3`,
      [tenantId, conn.property, rangeDays]
    );
    if (cached[0] && Date.now() - new Date(cached[0].fetched_at).getTime() < CACHE_TTL_MS) return cached[0].data;
  }

  const token = await accessToken(tenantId, conn);
  const end = Date.now() - 2 * DAY;
  const start = end - (rangeDays - 1) * DAY;
  const prevEnd = start - DAY;
  const prevStart = prevEnd - (rangeDays - 1) * DAY;
  const range = { startDate: iso(start), endDate: iso(end) };

  const [current, previous, daily, queries, pages] = await Promise.all([
    searchAnalytics(token, conn.property, { ...range }),
    searchAnalytics(token, conn.property, { startDate: iso(prevStart), endDate: iso(prevEnd) }),
    searchAnalytics(token, conn.property, { ...range, dimensions: ["date"], rowLimit: 100 }),
    searchAnalytics(token, conn.property, { ...range, dimensions: ["query"], rowLimit: 60 }),
    searchAnalytics(token, conn.property, { ...range, dimensions: ["page"], rowLimit: 25 }),
  ]);

  const data: Performance = {
    property: conn.property,
    rangeDays,
    startDate: range.startDate,
    endDate: range.endDate,
    fetchedAt: new Date().toISOString(),
    totals: totalsOf(current),
    previous: totalsOf(previous),
    daily: daily.map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions })).sort((a, b) => a.date.localeCompare(b.date)),
    queries: queries.map((r) => ({ query: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position, 1) })),
    pages: pages.map((r) => ({ page: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position, 1) })),
  };

  await query(
    `insert into search_console_snapshots (tenant_id, property, range_days, data, fetched_at) values ($1, $2, $3, $4::jsonb, now())
     on conflict (tenant_id, property, range_days) do update set data = excluded.data, fetched_at = now()`,
    [tenantId, conn.property, rangeDays, JSON.stringify(data)]
  );
  return data;
}

export const clearAccessCacheForTests = () => accessCache.clear();
