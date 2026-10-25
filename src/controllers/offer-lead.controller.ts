// controllers/offer-lead.controller.ts — a visitor fills in an offer's lead form on the owner's website (no login).

import type { Request, Response } from "express";
import * as leadIntake from "../services/lead-intake.service";
import * as leadService from "../services/lead.service";
import * as offerService from "../services/offer.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength, optionalString } from "../utils/validate";

const looksLikeContact = (v: string) => v.includes("@") || /\d{6,}/.test(v);

/** POST /api/public/offers/:id/lead — { siteKey, name?, contact, message? } */
export const submit = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const siteKey = body.siteKey ?? body.site_key;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  if (isNonEmptyString(body.website)) return res.status(201).json({ ok: true });

  const contact = optionalString(body.contact);
  if (!contact || !looksLikeContact(contact)) throw badRequest("invalid_contact");

  const offer = await offerService.getActiveOfferById(siteKey, req.params.id);
  if (!offer) throw notFound();

  const note = limitLength(optionalString(body.message), 1000, "message_too_long");
  const { lead, tenantId, siteSettings, duplicate } = await leadService.createFromSite({
    siteKey,
    contact: limitLength(contact, 160, "contact_too_long"),
    name: limitLength(optionalString(body.name), 120, "name_too_long"),
    message: `Interested in offer: ${offer.title}${note ? `\n${note}` : ""}`,
    source: "offer",
  });
  if (!duplicate) {
    await leadService.recordEvent(lead.id, "offer_submitted", { offerId: offer.id, title: offer.title });
    await leadIntake.afterNewLead(tenantId, siteSettings, lead, { awaitReply: false });
  }

  res.status(201).json({
    ok: true,
    successMessage: offer.successMessage || "Thanks! We'll be in touch very soon.",
    promoCode: offer.promoCode || "",
    whatsappNumber: offer.whatsappNumber || "",
    targetUrl: offer.targetUrl || "",
  });
});
