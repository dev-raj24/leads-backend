import type { Request, Response } from "express";
import { env } from "../config/env";
import * as reviews from "../services/google-reviews.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString, limitLength } from "../utils/validate";

export const status = asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});

/** POST /api/reviews/connect → { url } — send the owner to Google's consent screen. */
export const connect = asyncHandler(async (req: Request, res: Response) => {
  res.json({ url: reviews.consentUrl(req.tenantId!) });
});

/** GET /api/public/google-reviews/callback — Google sends the owner back here with a one-time code. */
export const callback = asyncHandler(async (req: Request, res: Response) => {
  const back = (qs: string) => res.redirect(`${env.appUrl}/reviews?${qs}`);
  if (typeof req.query.error === "string") return back("error=denied");
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string") return back("error=invalid");
  try {
    await reviews.completeConnection(code, state);
    return back("connected=1");
  } catch (err) {
    console.error("[google-reviews]", err instanceof Error ? err.message : err);
    return back("error=failed");
  }
});

export const locations = asyncHandler(async (req: Request, res: Response) => {
  res.json({ locations: await reviews.listLocations(req.tenantId!) });
});

export const choose = asyncHandler(async (req: Request, res: Response) => {
  const { accountId, locationId } = req.body ?? {};
  if (!isNonEmptyString(accountId) || !isNonEmptyString(locationId)) throw badRequest("missing_location");
  await reviews.chooseLocation(req.tenantId!, accountId, locationId);
  await reviews.syncReviews(req.tenantId!).catch(() => undefined);
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ reviews: await reviews.listReviews(req.tenantId!) });
});

/** POST /api/reviews/sync — pull any new reviews from Google now, instead of waiting for the hourly job. */
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

/** POST /api/reviews/:id/send — the owner's approved (or edited) reply, which is what actually posts to Google. */
export const send = asyncHandler(async (req: Request, res: Response) => {
  const text = limitLength(req.body?.text, 4000, "text_too_long");
  if (!isNonEmptyString(text)) throw badRequest("missing_text");
  res.json({ review: await reviews.sendReply(req.tenantId!, req.params.id, text) });
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  await reviews.disconnect(req.tenantId!);
  res.json({ status: await reviews.getStatus(req.tenantId!) });
});
