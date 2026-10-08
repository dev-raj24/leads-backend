// controllers/customer.controller.ts — req/res only. No SQL.

import type { Request, Response } from "express";
import * as customerService from "../services/customer.service";
import * as followupService from "../services/followup.service";
import * as leadService from "../services/lead.service";
import { asyncHandler } from "../utils/asyncHandler";
import { notFound } from "../utils/errors";

/** GET /api/customers — every contact that has ever enquired, most recently active first. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ customers: await customerService.getCustomersForTenant(req.tenantId!) });
});

/** GET /api/customers/:contact — one contact's full enquiry history + any open follow-ups. */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const contact = req.params.contact;
  const summary = await customerService.getCustomerSummary(req.tenantId!, contact);
  if (!summary) throw notFound("customer_not_found");

  const leads = await leadService.getLeadsForContact(req.tenantId!, contact);
  const leadIds = new Set(leads.map((l) => l.id));
  const followups = (await followupService.getFollowupsForTenant(req.tenantId!)).filter((f) => leadIds.has(f.leadId));

  res.json({ customer: summary, leads, followups });
});

/** GET /api/customers/:contact/export — everything held about one person, as JSON. */
export const exportData = asyncHandler(async (req: Request, res: Response) => {
  const data = await customerService.exportPerson(req.tenantId!, req.params.contact);
  if (!data) throw notFound("customer_not_found");
  res.setHeader("Content-Disposition", 'attachment; filename="customer-data.json"');
  res.json(data);
});

/** DELETE /api/customers/:contact — erases every lead, message and follow-up for this person and stops future automatic email to them. */
export const erase = asyncHandler(async (req: Request, res: Response) => {
  const removed = await customerService.erasePerson(req.tenantId!, req.params.contact);
  if (removed === 0) throw notFound("customer_not_found");
  res.json({ ok: true, removed });
});
