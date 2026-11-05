// services/review-source.service.ts — looks up a business's public Google reviews via a
// third-party search API (SerpApi's Google Maps engines) instead of Google's own Business
// Profile OAuth API. Reading public review data this way needs no Google app approval; the
// trade-off is that a reply can't be auto-posted back to Google (only the verified owner's
// own Google-authenticated call can do that) — the owner copies the AI draft and pastes it
// into the Google Business Profile app themselves. See src/types/review.ts for the shapes.
import { query } from "../config/db";
import { env } from "../config/env";
import * as aiService from "./ai.service";
import { AppError, badRequest, notFound } from "../utils/errors";
import type { BusinessMatch, GoogleReview, ReviewConnectionStatus, ReviewStatus } from "../types";

export const requireConfigured = () => {
  if (!env.serpApiConfigured) throw new AppError(503, "reviews_not_configured", "Review lookup is not set up on this server.");
};

async function serpGet<T>(params: Record<string, string>): Promise<T> {
  requireConfigured();
  const url = new URL(env.serpApiBase);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", env.serpApiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((err) => {
    console.error("[review-source]", err instanceof Error ? err.message : err);
    throw new AppError(502, "reviews_lookup_unavailable");
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || body?.error) {
    throw new AppError(502, "reviews_lookup_failed", typeof body?.error === "string" ? body.error : "Could not reach the review lookup service.");
  }
  return body as T;
}

export async function searchBusiness(businessQuery: string): Promise<BusinessMatch[]> {
  if (!businessQuery.trim()) throw badRequest("missing_query");
  const data = await serpGet<{ local_results?: Array<{ data_id?: string; title?: string; address?: string; rating?: number; reviews?: number }> }>({
    engine: "google_maps",
    q: businessQuery.trim(),
  });
  return (data.local_results ?? [])
    .filter((r) => r.data_id && r.title)
    .slice(0, 10)
    .map((r) => ({ dataId: r.data_id!, title: r.title!, address: r.address ?? null, rating: r.rating ?? null, reviewCount: r.reviews ?? null }));
}

interface ConnectionRow {
  data_id: string;
  business_name: string;
  address: string | null;
  last_error: string | null;
}

const getConnection = async (tenantId: string): Promise<ConnectionRow | null> => {
  const rows = await query<ConnectionRow>(`select * from review_source_connections where tenant_id = $1`, [tenantId]);
  return rows[0] ?? null;
};

export async function chooseBusiness(tenantId: string, dataId: string, businessName: string, address: string | null): Promise<void> {
  await query(
    `insert into review_source_connections (tenant_id, data_id, business_name, address, connected_at, last_error)
     values ($1, $2, $3, $4, now(), null)
     on conflict (tenant_id) do update
       set data_id = excluded.data_id, business_name = excluded.business_name, address = excluded.address, connected_at = now(), last_error = null`,
    [tenantId, dataId, businessName, address]
  );
}

export async function getStatus(tenantId: string): Promise<ReviewConnectionStatus> {
  const conn = await getConnection(tenantId);
  return {
    configured: env.serpApiConfigured,
    connected: Boolean(conn),
    businessName: conn?.business_name ?? null,
    address: conn?.address ?? null,
  };
}

export async function disconnect(tenantId: string): Promise<void> {
  await query(`delete from review_source_connections where tenant_id = $1`, [tenantId]);
  await query(`delete from reviews where tenant_id = $1`, [tenantId]);
}

interface ApiReview {
  review_id?: string;
  user?: { name?: string };
  rating?: number;
  snippet?: string;
  iso_date?: string;
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

/** Pulls any reviews SerpApi has that we haven't seen yet, and asks the AI to draft a reply for each. */
export async function syncReviews(tenantId: string): Promise<void> {
  const conn = await getConnection(tenantId);
  if (!conn) return;

  let data: { reviews?: ApiReview[] };
  try {
    data = await serpGet<{ reviews?: ApiReview[] }>({ engine: "google_maps_reviews", data_id: conn.data_id, sort_by: "newestFirst" });
  } catch (err) {
    console.error("[review-source] sync failed", tenantId, err instanceof Error ? err.message : err);
    await query(`update review_source_connections set last_error = $2 where tenant_id = $1`, [tenantId, "lookup_failed"]);
    return;
  }

  for (const r of data.reviews ?? []) {
    if (!r.review_id) continue;
    const existing = await query<{ id: string }>(`select id from reviews where tenant_id = $1 and review_id = $2`, [tenantId, r.review_id]);
    if (existing[0]) continue;

    const rating = typeof r.rating === "number" ? Math.round(r.rating) : null;
    const reviewerName = r.user?.name ?? null;
    const comment = r.snippet ?? null;

    const draft = await aiService.draftReviewReply(tenantId, { reviewerName, rating, comment }).catch((err) => {
      console.error("[review-source] draft failed", tenantId, err instanceof Error ? err.message : err);
      return null;
    });

    await query(
      `insert into reviews (tenant_id, review_id, reviewer_name, rating, comment, create_time, ai_draft, status, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending', now())
       on conflict (tenant_id, review_id) do nothing`,
      [tenantId, r.review_id, reviewerName, rating, comment, r.iso_date ?? null, draft]
    );
  }

  await query(`update review_source_connections set last_polled_at = now(), last_error = null where tenant_id = $1`, [tenantId]);
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

/** The owner copied this (possibly edited) text to paste into Google themselves — we just record it. */
export async function markCopied(tenantId: string, id: string, text: string): Promise<GoogleReview> {
  const rows = await query<Row>(
    `update reviews set status = 'sent', sent_reply = $3, sent_at = now() where tenant_id = $1 and id = $2 returning *`,
    [tenantId, id, text]
  );
  if (!rows[0]) throw notFound();
  return toReview(rows[0]);
}

export async function listTrackedTenants(): Promise<string[]> {
  const rows = await query<{ tenant_id: string }>(`select tenant_id from review_source_connections where last_error is null`);
  return rows.map((r) => r.tenant_id);
}
