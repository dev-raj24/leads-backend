import type { Request, Response } from "express";
import * as billingService from "../services/billing.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";

export const overview = asyncHandler(async (req: Request, res: Response) => {
  res.json(await billingService.getOverview(req.tenantId!));
});

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  res.json(await billingService.startSubscription(req.tenantId!));
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  await billingService.cancelSubscription(req.tenantId!);
  res.json({ ok: true, ...(await billingService.getOverview(req.tenantId!)) });
});

/** POST /api/public/billing/razorpay-webhook — signed by Razorpay, handled exactly once per event id. */
export const razorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!billingService.verifyWebhookSignature(req.rawBody, req.get("x-razorpay-signature"))) {
    return res.status(400).json({ error: "invalid_signature" });
  }
  const eventId = req.get("x-razorpay-event-id");
  if (!eventId) throw badRequest("missing_event_id");
  const result = await billingService.handleWebhook(eventId, req.body);
  res.json({ ok: true, ...result });
});
