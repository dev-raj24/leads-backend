// controllers/offer.controller.ts — req/res handling for offers.

import type { Request, Response } from "express";
import * as offerService from "../services/offer.service";
import * as siteService from "../services/site.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

/** The presentation fields shared by create + update. Accepts legacy link aliases. */
function pickOfferConfig(body: Record<string, any>) {
  const {
    color, displayMode, styleVariant, actionType, promoCode,
    targetUrl, linkUrl, redirectUrl, whatsappNumber,
  } = body;
  return {
    color, displayMode, styleVariant, actionType, promoCode, whatsappNumber,
    targetUrl: targetUrl || linkUrl || redirectUrl,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ offers: await offerService.getOffersForTenant(req.tenantId!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!isNonEmptyString(body.title)) throw badRequest("missing_title");

  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const offer = await offerService.createOffer(req.tenantId!, site?.id ?? null, {
    title: body.title.trim(),
    body: body.body,
    active: body.active,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    ...pickOfferConfig(body),
  });
  res.status(201).json({ offer });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const offer = await offerService.updateOffer(req.tenantId!, req.params.id, {
    active: body.active,
    title: body.title,
    body: body.body,
    ...pickOfferConfig(body),
  });
  if (!offer) throw notFound();
  res.json({ offer });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  if (!(await offerService.deleteOffer(req.tenantId!, req.params.id))) throw notFound();
  res.json({ ok: true });
});

const ACTION_TEXT: Record<string, string> = {
  whatsapp: "Chat on WhatsApp",
  promo: "Get the code",
  link: "Claim offer",
};

/** GET /api/public/widget-config?siteKey= — what the website widget shows (no login). */
export const publicWidgetConfig = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");

  const offer = await offerService.getActiveOfferForSiteKey(siteKey);
  res.json({
    offer: offer && {
      title: offer.title,
      body: offer.body ?? "",
      displayMode: offer.displayMode ?? "top",
      color: offer.color,
      actionType: offer.actionType,
      actionText: ACTION_TEXT[offer.actionType ?? "link"] ?? ACTION_TEXT.link,
      targetUrl: offer.targetUrl,
      whatsappNumber: offer.whatsappNumber,
      promoCode: offer.promoCode,
    },
  });
});
