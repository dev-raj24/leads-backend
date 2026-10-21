// services/google-reviews.service.ts — connects a tenant's Google Business Profile,
// pulls in new reviews, and posts the owner-approved reply back to Google.
//
// Note for whoever sets GOOGLE_CLIENT_ID/SECRET up in production: this reuses the same
// OAuth client as Search Console but needs its own redirect URI
// (<PUBLIC_API_URL>/api/public/google-reviews/callback) added in Google Cloud Console,
// the "Google My Business API" enabled on the project, and — historically — Google's
// separate Business Profile API access request form approved for the project. Until
// that is approved, reviews.list/reply calls below return 403 PERMISSION_DENIED even
// with a valid token.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { query } from "../config/db";
import { env } from "../config/env";
import * as aiService from "./ai.service";
import { AppError, badRequest, notFound } from "../utils/errors";
import { open, seal } from "../utils/secretbox";
import type { GoogleLocation, GoogleReview, ReviewConnectionStatus, ReviewStatus } from "../types";

const SCOPES = ["https://www.googleapis.com/auth/business.manage"];
const STATE_TTL_MS = 10 * 60 * 1000;

export const requireConfigured = () => {
  if (!env.googleConfigured) throw new AppError(503, "google_not_configured", "Google sign-in is not set up on this server.");
};

const redirectUri = () => `${env.publicApiUrl}/api/public/google-reviews/callback`;

const sign = (payload: string) => createHmac("sha256", env.jwtSecret).update(`gbr-state:${payload}`).digest("base64url");

function makeState(tenantId: string): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, n: randomBytes(8).toString("hex"), e: Date.now() + STATE_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readState(state: string): string | null {
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
    `insert into google_business_connections (tenant_id, google_email, refresh_token_enc, account_id, location_id, location_name, connected_at, last_error)
     values ($1, $2, $3, null, null, null, now(), null)
     on conflict (tenant_id) do update
       set google_email = excluded.google_email, refresh_token_enc = excluded.refresh_token_enc, account_id = null, location_id = null, location_name = null, connected_at = now(), last_error = null`,
    [tenantId, info.email ?? null, seal(tokens.refresh_token)]
  );
  accessCache.delete(tenantId);
  return tenantId;
}

interface Connection {
  google_email: string | null;
  refresh_token_enc: string;
  account_id: string | null;
  location_id: string | null;
  location_name: string | null;
  last_error: string | null;
}

const getConnection = async (tenantId: string): Promise<Connection | null> => {
  const rows = await query<Connection>(`select * from google_business_connections where tenant_id = $1`, [tenantId]);
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
      await query(`update google_business_connections set last_error = 'access_revoked' where tenant_id = $1`, [tenantId]);
    }
    throw err;
  }
}

export async function getStatus(tenantId: string): Promise<ReviewConnectionStatus> {
  const conn = await getConnection(tenantId);
  return {
    configured: env.googleConfigured,
    connected: Boolean(conn),
    email: conn?.google_email ?? null,
    locationId: conn?.location_id ?? null,
    locationName: conn?.location_name ?? null,
    needsReconnect: conn?.last_error === "access_revoked",
  };
}

export async function listLocations(tenantId: string): Promise<GoogleLocation[]> {
  const conn = await getConnection(tenantId);
  if (!conn) throw new AppError(409, "not_connected");
  const token = await accessToken(tenantId, conn);

  const accounts = await googleJson<{ accounts?: Array<{ name: string }> }>(`${env.google.accountsBase}/accounts`, { headers: { authorization: `Bearer ${token}` } });

  const lists = await Promise.all(
    (accounts.accounts ?? []).map(async (account) => {
      const data = await googleJson<{ locations?: Array<{ name: string; title?: string }> }>(
        `${env.google.businessInfoBase}/${account.name}/locations?readMask=name,title`,
        { headers: { authorization: `Bearer ${token}` } }
      ).catch(() => ({ locations: [] }));
      const accountId = account.name.replace(/^accounts\//, "");
      return (data.locations ?? []).map((loc) => ({
        accountId,
        locationId: loc.name.replace(/^locations\//, ""),
        title: loc.title ?? loc.name,
      }));
    })
  );
  return lists.flat();
}

export async function chooseLocation(tenantId: string, accountId: string, locationId: string): Promise<void> {
  const known = await listLocations(tenantId);
  const match = known.find((l) => l.accountId === accountId && l.locationId === locationId);
  if (!match) throw badRequest("unknown_location");
  await query(
    `update google_business_connections set account_id = $2, location_id = $3, location_name = $4 where tenant_id = $1`,
    [tenantId, accountId, locationId, match.title]
  );
}

export async function disconnect(tenantId: string): Promise<void> {
  const conn = await getConnection(tenantId);
  if (conn && env.googleConfigured) {
    await fetch(`${env.google.tokenBase}/revoke`, tokenForm({ token: open(conn.refresh_token_enc) })).catch(() => undefined);
  }
  await query(`delete from google_business_connections where tenant_id = $1`, [tenantId]);
  await query(`delete from reviews where tenant_id = $1`, [tenantId]);
  accessCache.delete(tenantId);
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface ApiReview {
  reviewId: string;
  reviewer?: { displayName?: string };
  starRating?: keyof typeof STARS;
  comment?: string;
  createTime?: string;
}

interface Row {
  id: string;
  review_id: string;
  reviewer_name: string | null;
  rating: number | null;
  comment: string | null;
  create_time: string | null;
  ai_draft: string | null;
  status: ReviewStatus;
  sent_reply: string | null;
  sent_at: string | null;
}

const toReview = (r: Row): GoogleReview => ({
  id: r.id,
  reviewId: r.review_id,
  reviewerName: r.reviewer_name,
  rating: r.rating,
  comment: r.comment,
  createTime: r.create_time,
  aiDraft: r.ai_draft,
  status: r.status,
  sentReply: r.sent_reply,
  sentAt: r.sent_at,
});

/** Pulls any reviews Google has that we haven't seen yet, and asks the AI to draft a reply for each. */
export async function syncReviews(tenantId: string): Promise<void> {
  const conn = await getConnection(tenantId);
  if (!conn || !conn.account_id || !conn.location_id) return;
  const token = await accessToken(tenantId, conn);

  const data = await googleJson<{ reviews?: ApiReview[] }>(
    `${env.google.myBusinessBase}/accounts/${conn.account_id}/locations/${conn.location_id}/reviews?pageSize=50`,
    { headers: { authorization: `Bearer ${token}` } }
  );

  for (const r of data.reviews ?? []) {
    const existing = await query<{ id: string }>(`select id from reviews where tenant_id = $1 and review_id = $2`, [tenantId, r.reviewId]);
    if (existing[0]) continue;

    const rating = r.starRating ? STARS[r.starRating] ?? null : null;
    const reviewerName = r.reviewer?.displayName ?? null;
    const comment = r.comment ?? null;

    const draft = await aiService.draftReviewReply(tenantId, { reviewerName, rating, comment }).catch((err) => {
      console.error("[google-reviews] draft failed", tenantId, err instanceof Error ? err.message : err);
      return null;
    });

    await query(
      `insert into reviews (tenant_id, review_id, reviewer_name, rating, comment, create_time, ai_draft, status, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending', now())
       on conflict (tenant_id, review_id) do nothing`,
      [tenantId, r.reviewId, reviewerName, rating, comment, r.createTime ?? null, draft]
    );
  }

  await query(`update google_business_connections set last_polled_at = now() where tenant_id = $1`, [tenantId]);
}

export async function listReviews(tenantId: string): Promise<GoogleReview[]> {
  const rows = await query<Row>(`select * from reviews where tenant_id = $1 order by create_time desc nulls last, fetched_at desc`, [tenantId]);
  return rows.map(toReview);
}

async function getReviewRow(tenantId: string, id: string): Promise<Row> {
  const rows = await query<Row>(`select * from reviews where tenant_id = $1 and id = $2`, [tenantId, id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function regenerateDraft(tenantId: string, id: string): Promise<GoogleReview> {
  const row = await getReviewRow(tenantId, id);
  const draft = await aiService.draftReviewReply(tenantId, { reviewerName: row.reviewer_name, rating: row.rating, comment: row.comment });
  const rows = await query<Row>(`update reviews set ai_draft = $3 where tenant_id = $1 and id = $2 returning *`, [tenantId, id, draft]);
  return toReview(rows[0]);
}

export async function skipReview(tenantId: string, id: string): Promise<GoogleReview> {
  const rows = await query<Row>(`update reviews set status = 'skipped' where tenant_id = $1 and id = $2 returning *`, [tenantId, id]);
  if (!rows[0]) throw notFound();
  return toReview(rows[0]);
}

/** Owner approves (optionally edited) text, which is what actually gets posted to Google. */
export async function sendReply(tenantId: string, id: string, text: string): Promise<GoogleReview> {
  const row = await getReviewRow(tenantId, id);
  const conn = await getConnection(tenantId);
  if (!conn || !conn.account_id || !conn.location_id) throw new AppError(409, "not_connected");
  const token = await accessToken(tenantId, conn);

  await googleJson(
    `${env.google.myBusinessBase}/accounts/${conn.account_id}/locations/${conn.location_id}/reviews/${row.review_id}/reply`,
    { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ comment: text }) }
  );

  const rows = await query<Row>(
    `update reviews set status = 'sent', sent_reply = $3, sent_at = now() where tenant_id = $1 and id = $2 returning *`,
    [tenantId, id, text]
  );
  return toReview(rows[0]);
}

export async function listTrackedTenants(): Promise<string[]> {
  const rows = await query<{ tenant_id: string }>(
    `select tenant_id from google_business_connections where location_id is not null and last_error is null`
  );
  return rows.map((r) => r.tenant_id);
}
