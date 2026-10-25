import { createHmac, timingSafeEqual } from "crypto";
import { pool, query } from "../config/db";
import { env } from "../config/env";
import { PLAN_DEFS } from "../config/plans";
import { AppError, badRequest } from "../utils/errors";
import * as usageService from "./usage.service";
import { getTenant } from "./tenant.service";

const API = "https://api.razorpay.com/v1";

async function razorpay<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    console.error("[razorpay]", res.status, json?.error?.description);
    throw new AppError(502, "payment_provider_error", json?.error?.description ?? "The payment provider rejected the request.");
  }
  return json as T;
}

export async function getOverview(tenantId: string) {
  const [tenant, usage] = await Promise.all([getTenant(tenantId), usageService.getUsage(tenantId)]);
  return {
    plan: tenant.plan,
    planStatus: tenant.planStatus,
    planRenewsAt: tenant.planRenewsAt,
    canSubscribe: env.billingConfigured || env.selfServePro,
    billingConfigured: env.billingConfigured,
    usage,
    plans: Object.values(PLAN_DEFS),
  };
}

export async function startSubscription(tenantId: string): Promise<{ url: string | null; activated: boolean }> {
  const tenant = await getTenant(tenantId);
  if (tenant.plan === "pro" && tenant.planStatus === "active") throw badRequest("already_subscribed");

  if (!env.billingConfigured) {
    if (!env.selfServePro) throw new AppError(503, "billing_not_configured", "Payments are not set up yet.");
    await query(`update tenants set plan = 'pro', plan_status = 'active', onboarding_completed = true where id = $1`, [tenantId]);
    return { url: null, activated: true };
  }

  const sub = await razorpay<{ id: string; short_url: string }>("POST", "/subscriptions", {
    plan_id: env.razorpay.planId,
    total_count: 120,
    customer_notify: 1,
    notes: { tenantId },
  });
  await query(`update tenants set razorpay_subscription_id = $2 where id = $1`, [tenantId, sub.id]);
  return { url: sub.short_url, activated: false };
}

export async function cancelSubscription(tenantId: string): Promise<void> {
  const tenant = await getTenant(tenantId);
  const rows = await query<{ razorpay_subscription_id: string | null }>(
    `select razorpay_subscription_id from tenants where id = $1`,
    [tenantId]
  );
  const subId = rows[0]?.razorpay_subscription_id;

  if (!subId || !env.billingConfigured) {
    if (tenant.plan === "pro" && env.selfServePro) {
      await query(`update tenants set plan = 'free', plan_status = 'active', plan_renews_at = null where id = $1`, [tenantId]);
      return;
    }
    throw badRequest("no_active_subscription");
  }

  await razorpay("POST", `/subscriptions/${subId}/cancel`, { cancel_at_cycle_end: 1 });
  await query(`update tenants set plan_status = 'cancelling' where id = $1`, [tenantId]);
}

export function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!rawBody || !signature || !env.razorpay.webhookSecret) return false;
  const expected = Buffer.from(createHmac("sha256", env.razorpay.webhookSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface WebhookPayload {
  event: string;
  payload?: { subscription?: { entity?: { id: string; current_end?: number; notes?: { tenantId?: string } } } };
}

const ACTIVATING = new Set(["subscription.activated", "subscription.charged", "subscription.resumed"]);
const ENDING = new Set(["subscription.cancelled", "subscription.completed", "subscription.halted", "subscription.expired"]);

export async function handleWebhook(eventId: string, body: WebhookPayload): Promise<{ handled: boolean; duplicate: boolean }> {
  if (!pool) throw badRequest("database_not_configured");
  const entity = body.payload?.subscription?.entity;
  const rows = entity
    ? await query<{ id: string }>(
        `select id from tenants where razorpay_subscription_id = $1 or id::text = $2 limit 1`,
        [entity.id, entity.notes?.tenantId ?? ""]
      )
    : [];
  const tenantId = rows[0]?.id ?? null;

  const inserted = await query<{ id: string }>(
    `insert into billing_events (id, type, tenant_id, payload) values ($1, $2, $3, $4::jsonb)
     on conflict (id) do nothing returning id`,
    [eventId, body.event, tenantId, JSON.stringify(body)]
  );
  if (inserted.length === 0) return { handled: false, duplicate: true };
  if (!tenantId || !entity) return { handled: false, duplicate: false };

  if (ACTIVATING.has(body.event)) {
    await query(
      `update tenants set plan = 'pro', plan_status = 'active', razorpay_subscription_id = $2,
              plan_renews_at = case when $3::bigint is null then plan_renews_at else to_timestamp($3::bigint) end,
              onboarding_completed = true
       where id = $1`,
      [tenantId, entity.id, entity.current_end ?? null]
    );
    return { handled: true, duplicate: false };
  }
  if (ENDING.has(body.event)) {
    await query(`update tenants set plan = 'free', plan_status = 'active', plan_renews_at = null where id = $1`, [tenantId]);
    return { handled: true, duplicate: false };
  }
  if (body.event === "subscription.pending") {
    await query(`update tenants set plan_status = 'past_due' where id = $1`, [tenantId]);
    return { handled: true, duplicate: false };
  }
  return { handled: false, duplicate: false };
}
