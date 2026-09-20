import type { Request, Response } from "express";
import * as followupService from "../services/followup.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { limitLength, optionalString } from "../utils/validate";

const MAX_AHEAD_MS = 90 * 24 * 3600 * 1000;

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followups: await followupService.getFollowupsForTenant(req.tenantId!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const runAt = new Date(req.body?.runAt ?? Date.now() + 48 * 3600 * 1000);
  if (Number.isNaN(runAt.getTime()) || runAt.getTime() > Date.now() + MAX_AHEAD_MS) throw badRequest("invalid_run_at");
  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");

  const followup = await followupService.createFollowup(req.tenantId!, req.params.leadId, runAt, template);
  res.status(201).json({ followup });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const template = limitLength(optionalString(req.body?.template), 1000, "template_too_long");
  res.json({ followup: await followupService.approveFollowup(req.tenantId!, req.params.id, template) });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followup: await followupService.cancelFollowup(req.tenantId!, req.params.id) });
});

export const markSent = asyncHandler(async (req: Request, res: Response) => {
  res.json({ followup: await followupService.markFollowupSent(req.tenantId!, req.params.id) });
});
