import type { Request, Response } from "express";
import * as reviews from "../services/review-source.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString, limitLength } from "../utils/validate";

export const status = asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});

/** GET /api/reviews/search?q=... — look up Google Maps listings matching the owner's business. */
export const search = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query.q;
  if (!isNonEmptyString(q)) throw badRequest("missing_query");
  res.json({ matches: await reviews.searchBusiness(limitLength(q, 200, "query_too_long")) });
});

export const choose = asyncHandler(async (req: Request, res: Response) => {
  const { dataId, title, address } = req.body ?? {};
  if (!isNonEmptyString(dataId) || !isNonEmptyString(title)) throw badRequest("missing_business");
  await reviews.chooseBusiness(req.tenantId!, dataId, title, typeof address === "string" ? address : null);
  await reviews.syncReviews(req.tenantId!).catch(() => undefined);
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ reviews: await reviews.listReviews(req.tenantId!) });
});

/** POST /api/reviews/sync — pull any new reviews now, instead of waiting for the ~15 min job. */
export const sync = asyncHandler(async (req: Request, res: Response) => {
  await reviews.syncReviews(req.tenantId!);
  res.json({ reviews: await reviews.listReviews(req.tenantId!) });
});

export const regenerate = asyncHandler(async (req: Request, res: Response) => {
  res.json({ review: await reviews.regenerateDraft(req.tenantId!, req.params.id) });
});

export const skip = asyncHandler(async (req: Request, res: Response) => {
  res.json({ review: await reviews.skipReview(req.tenantId!, req.params.id) });
});

/** POST /api/reviews/:id/copy — the owner copied this (approved/edited) text to paste into Google themselves. */
export const copy = asyncHandler(async (req: Request, res: Response) => {
  const text = limitLength(req.body?.text, 4000, "text_too_long");
  if (!isNonEmptyString(text)) throw badRequest("missing_text");
  res.json({ review: await reviews.markCopied(req.tenantId!, req.params.id, text) });
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  await reviews.disconnect(req.tenantId!);
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});
