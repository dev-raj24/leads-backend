// services/offer.service.ts — business logic for offers.

import { query } from "../config/db";
import type { Offer } from "../types";

interface OfferRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  title: string;
  body: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

function toOffer(row: OfferRow): Offer {
  let parsedConfig: Record<string, any> = {};
  let bodyText = row.body;

  if (row.body && (row.body.startsWith("{") || row.body.startsWith("["))) {
    try {
      parsedConfig = JSON.parse(row.body);
      bodyText = parsedConfig.body ?? "";
    } catch {
      // plain text fallback
    }
  }

  const targetUrl = parsedConfig.targetUrl || parsedConfig.linkUrl || parsedConfig.redirectUrl || "";
  const whatsappNumber = parsedConfig.whatsappNumber || undefined;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    title: row.title,
    body: bodyText,
    active: row.active,
    color: parsedConfig.color,
    displayMode: parsedConfig.displayMode,
    styleVariant: parsedConfig.styleVariant,
    actionType: parsedConfig.actionType,
    promoCode: parsedConfig.promoCode,
    targetUrl,
    whatsappNumber,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

export async function getOffersForTenant(tenantId: string): Promise<Offer[]> {
  const rows = await query<OfferRow>(
    `select * from offers where tenant_id = $1 order by created_at desc`,
    [tenantId]
  );
  return rows.map(toOffer);
}

export async function createOffer(
  tenantId: string,
  input: {
    title: string;
    body?: string;
    active?: boolean;
    color?: string;
    displayMode?: string;
    styleVariant?: string;
    actionType?: string;
    promoCode?: string;
    targetUrl?: string;
    whatsappNumber?: string;
    startsAt?: string;
    endsAt?: string;
  }
): Promise<Offer> {
  const payload = JSON.stringify({
    body: input.body ?? "",
    color: input.color,
    displayMode: input.displayMode,
    styleVariant: input.styleVariant,
    actionType: input.actionType,
    promoCode: input.promoCode,
    targetUrl: input.targetUrl,
    whatsappNumber: input.whatsappNumber,
  });

  const rows = await query<OfferRow>(
    `insert into offers (tenant_id, title, body, active, starts_at, ends_at)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      tenantId,
      input.title,
      payload,
      input.active ?? false,
      input.startsAt ?? null,
      input.endsAt ?? null,
    ]
  );
  return toOffer(rows[0]);
}

export async function updateOffer(
  tenantId: string,
  offerId: string,
  input: {
    active?: boolean;
    title?: string;
    body?: string;
    color?: string;
    displayMode?: string;
    styleVariant?: string;
    actionType?: string;
    promoCode?: string;
    targetUrl?: string;
    whatsappNumber?: string;
  }
): Promise<Offer | null> {
  const existingRows = await query<OfferRow>(
    `select * from offers where id = $2 and tenant_id = $1 limit 1`,
    [tenantId, offerId]
  );
  const existing = existingRows[0];
  if (!existing) return null;

  let existingConfig: Record<string, any> = {};
  if (existing.body && (existing.body.startsWith("{") || existing.body.startsWith("["))) {
    try {
      existingConfig = JSON.parse(existing.body);
    } catch {
      existingConfig = { body: existing.body };
    }
  } else {
    existingConfig = { body: existing.body };
  }

  const updatedConfig = JSON.stringify({
    body: input.body !== undefined ? input.body : existingConfig.body,
    color: input.color !== undefined ? input.color : existingConfig.color,
    displayMode: input.displayMode !== undefined ? input.displayMode : existingConfig.displayMode,
    styleVariant: input.styleVariant !== undefined ? input.styleVariant : existingConfig.styleVariant,
    actionType: input.actionType !== undefined ? input.actionType : existingConfig.actionType,
    promoCode: input.promoCode !== undefined ? input.promoCode : existingConfig.promoCode,
    targetUrl: input.targetUrl !== undefined ? input.targetUrl : (existingConfig.targetUrl || existingConfig.linkUrl || existingConfig.redirectUrl),
    whatsappNumber: input.whatsappNumber !== undefined ? input.whatsappNumber : existingConfig.whatsappNumber,
  });

  const rows = await query<OfferRow>(
    `update offers
     set active = coalesce($3, active),
         title = coalesce($4, title),
         body = $5
     where id = $2 and tenant_id = $1
     returning *`,
    [tenantId, offerId, input.active ?? null, input.title ?? null, updatedConfig]
  );
  return rows[0] ? toOffer(rows[0]) : null;
}

export async function deleteOffer(tenantId: string, offerId: string): Promise<boolean> {
  const rows = await query(
    `delete from offers where id = $2 and tenant_id = $1 returning id`,
    [tenantId, offerId]
  );
  return rows.length > 0;
}
