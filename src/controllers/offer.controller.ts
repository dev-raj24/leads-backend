// controllers/offer.controller.ts — req/res handling for offers.

import type { Request, Response } from "express";
import * as offerService from "../services/offer.service";
import { normalizeLeadFields } from "../services/site.service";
import * as siteService from "../services/site.service";
import { getTenant } from "../services/tenant.service";
import { readChatDesign } from "../services/widget-design.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sanitizeCss } from "../utils/css";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength } from "../utils/validate";
import type { Offer } from "../types";

/** The presentation fields shared by create + update. Accepts legacy link aliases. */
const short = (v: unknown, code: string) => (typeof v === "string" ? limitLength(v, 500, code) : undefined);

function pickOfferConfig(body: Record<string, any>) {
  const { color, textColor, buttonText, displayMode, styleVariant, actionType, promoCode, targetUrl, linkUrl, redirectUrl, whatsappNumber, successMessage, modalDelay, fontFamily, radius, customCss } = body;
  return {
    successMessage: short(successMessage, "success_message_too_long"),
    modalDelay: typeof modalDelay === "number" && Number.isFinite(modalDelay) ? Math.min(120, Math.max(0, Math.round(modalDelay))) : undefined,
    fontFamily: fontFamily === "inherit" || fontFamily === "system" ? fontFamily : undefined,
    radius: radius === "square" || radius === "rounded" ? radius : undefined,
    customCss: typeof customCss === "string" ? sanitizeCss(customCss) : undefined,
    color: short(color, "color_too_long"),
    textColor: short(textColor, "color_too_long"),
    buttonText: short(buttonText, "button_text_too_long"),
    displayMode: short(displayMode, "display_mode_too_long"),
    styleVariant: short(styleVariant, "style_variant_too_long"),
    actionType: short(actionType, "action_type_too_long"),
    promoCode: short(promoCode, "promo_code_too_long"),
    whatsappNumber: short(whatsappNumber, "whatsapp_too_long"),
    targetUrl: short(targetUrl || linkUrl || redirectUrl, "url_too_long"),
  };
}

const dateOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw badRequest("invalid_date");
  return new Date(v).toISOString();
};

const longText = (v: unknown) => (typeof v === "string" ? limitLength(v, 2000, "body_too_long") : undefined);

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ offers: await offerService.getOffersForTenant(req.tenantId!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!isNonEmptyString(body.title)) throw badRequest("missing_title");

  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const offer = await offerService.createOffer(req.tenantId!, site?.id ?? null, {
    title: limitLength(body.title.trim(), 200, "title_too_long"),
    body: longText(body.body),
    active: typeof body.active === "boolean" ? body.active : undefined,
    startsAt: dateOrNull(body.startsAt) ?? undefined,
    endsAt: dateOrNull(body.endsAt) ?? undefined,
    ...pickOfferConfig(body),
  });
  res.status(201).json({ offer });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const offer = await offerService.updateOffer(req.tenantId!, req.params.id, {
    active: typeof body.active === "boolean" ? body.active : undefined,
    title: typeof body.title === "string" ? limitLength(body.title.trim(), 200, "title_too_long") : undefined,
    body: longText(body.body),
    startsAt: dateOrNull(body.startsAt),
    endsAt: dateOrNull(body.endsAt),
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
  form: "Get this offer",
};

/** What a website visitor may see of an offer. A lead-form offer keeps its reward back until the form is submitted. */
export function toPublicOffer(offer: Offer) {
  const gated = offer.actionType === "form";
  return {
    id: offer.id,
    title: offer.title,
    body: offer.body ?? "",
    displayMode: !offer.displayMode || offer.displayMode === "top" ? "bottom-left" : offer.displayMode,
    color: offer.color,
    textColor: offer.textColor,
    styleVariant: offer.styleVariant ?? "solid",
    actionType: offer.actionType ?? "link",
    actionText: offer.buttonText || (ACTION_TEXT[offer.actionType ?? "link"] ?? ACTION_TEXT.link),
    targetUrl: gated ? "" : offer.targetUrl,
    whatsappNumber: gated ? "" : offer.whatsappNumber,
    promoCode: gated ? "" : offer.promoCode,
    modalDelay: offer.modalDelay ?? 5,
    fontFamily: offer.fontFamily ?? "system",
    radius: offer.radius ?? "rounded",
    customCss: offer.customCss ?? "",
  };
}

/** GET /api/public/offers/:id?siteKey= — one specific live offer, for a pinned inline embed. */
export const publicOfferById = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  const offer = await offerService.getActiveOfferById(siteKey, req.params.id);
  if (!offer) throw notFound();
  res.json({ offer: toPublicOffer(offer) });
});

/** GET /api/public/widget-config?siteKey= — what the website embed script shows (no login). */
export const publicWidgetConfig = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");

  const site = await siteService.getSiteByApiKey(siteKey);
  if (!site) throw notFound("invalid_site_key");

  const [offer, tenant] = await Promise.all([
    offerService.getActiveOfferForSiteKey(siteKey),
    getTenant(site.tenantId),
  ]);

  res.json({
    offer: offer && toPublicOffer(offer),
    chat: {
      enabled: tenant.plan === "pro" && site.settings?.widget === true,
      design: readChatDesign(site.settings?.widgetDesign),
    },
    blog: { enabled: tenant.plan === "pro" },
    form: { fields: normalizeLeadFields(site.settings?.leadFields) },
  });
});
