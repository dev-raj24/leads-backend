// controllers/offer.controller.ts — req/res handling for offers.

import type { Request, Response } from "express";
import * as offerService from "../services/offer.service";

export async function list(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "missing_tenant" });

  try {
    const offers = await offerService.getOffersForTenant(tenantId);
    return res.json({ offers });
  } catch (err) {
    console.error("[offer.controller.list]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

export async function create(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { title, body, active, startsAt, endsAt, color, displayMode, styleVariant, actionType, promoCode, targetUrl, linkUrl, redirectUrl, whatsappNumber } = req.body;
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "missing_title" });
  }

  const finalTargetUrl = targetUrl || linkUrl || redirectUrl;

  try {
    const offer = await offerService.createOffer(tenantId, {
      title,
      body,
      active,
      startsAt,
      endsAt,
      color,
      displayMode,
      styleVariant,
      actionType,
      promoCode,
      targetUrl: finalTargetUrl,
      whatsappNumber,
    });
    return res.status(201).json({ offer });
  } catch (err) {
    console.error("[offer.controller.create]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

export async function update(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { id } = req.params;
  const { active, title, body, color, displayMode, styleVariant, actionType, promoCode, targetUrl, linkUrl, redirectUrl, whatsappNumber } = req.body;

  const finalTargetUrl = targetUrl || linkUrl || redirectUrl;

  try {
    const offer = await offerService.updateOffer(tenantId, id, {
      active,
      title,
      body,
      color,
      displayMode,
      styleVariant,
      actionType,
      promoCode,
      targetUrl: finalTargetUrl,
      whatsappNumber,
    });
    if (!offer) return res.status(404).json({ error: "not_found" });
    return res.json({ offer });
  } catch (err) {
    console.error("[offer.controller.update]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

export async function remove(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { id } = req.params;

  try {
    const deleted = await offerService.deleteOffer(tenantId, id);
    if (!deleted) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[offer.controller.remove]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
