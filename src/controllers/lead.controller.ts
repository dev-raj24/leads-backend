// controllers/lead.controller.ts — req/res + input validation only.
// Rule: NO SQL here. Calls services; errors flow to error.middleware.

import type { Request, Response } from "express";
import * as leadService from "../services/lead.service";
import * as leadImportService from "../services/lead-import.service";
import * as siteService from "../services/site.service";
import { LEAD_SOURCES, LEAD_STATUSES, type LeadStatus } from "../types";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, optionalString } from "../utils/validate";

const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);

/** POST /api/ingest/lead — public, called by the site widget/form with a site key. */
export const ingest = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const siteKey = body.site_key ?? body.siteKey;
  const contact = body.contact ?? body.phone ?? body.email;

  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  if (!isNonEmptyString(contact)) throw badRequest("missing_contact");

  const lead = await leadService.createFromSite({
    siteKey,
    contact: contact.trim(),
    name: optionalString(body.name),
    message: optionalString(body.message),
  });
  res.status(201).json({ ok: true, id: lead.id });
});

/** GET /api/leads?status= */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status;
  if (status !== undefined && !isLeadStatus(status)) throw badRequest("invalid_status");

  const leads = await leadService.getLeadsForTenant(req.tenantId!, status);
  res.json({ leads });
});

/** GET /api/leads/:id */
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.getLeadById(req.tenantId!, req.params.id);
  if (!lead) throw notFound();
  res.json({ lead });
});

/** PATCH /api/leads/:id — { status } */
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = req.body?.status;
  if (!isNonEmptyString(status)) throw badRequest("missing_status");
  if (!isLeadStatus(status)) throw badRequest("invalid_status");

  const lead = await leadService.updateLeadStatus(req.tenantId!, req.params.id, status);
  if (!lead) throw notFound();
  res.json({ lead });
});

/** GET /api/leads/template — xlsx with the tenant's custom lead fields as extra columns. */
export const downloadTemplate = asyncHandler(async (req: Request, res: Response) => {
  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const leadFields = site?.settings?.leadFields;
  const extraFields = Array.isArray(leadFields)
    ? leadFields.map((f: { name?: unknown }) => String(f?.name ?? "")).filter(Boolean)
    : [];

  const buffer = await leadImportService.buildTemplate(extraFields);
  res.setHeader("Content-Disposition", 'attachment; filename="leads_template.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(buffer);
});

/** POST /api/leads/upload-preview — multipart "file"; validates rows, saves nothing. */
export const uploadPreview = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw badRequest("missing_file");

  const preview = await leadImportService.parseLeadsWorkbook(req.file.buffer);
  if (!preview) throw badRequest("empty_excel");
  res.json(preview);
});

/** POST /api/leads/bulk — { leads: [...] } (rows from a confirmed preview). */
export const bulkIngest = asyncHandler(async (req: Request, res: Response) => {
  const leads = req.body?.leads;
  if (!Array.isArray(leads)) throw badRequest("invalid_payload");

  const clean = leads.flatMap((l) => {
    const contact = optionalString(l?.contact);
    if (!contact) return [];
    const source = (LEAD_SOURCES as readonly string[]).includes(l?.source) ? l.source : "form";
    return [{ contact, source, name: optionalString(l.name), message: optionalString(l.message), customFields: l.customFields }];
  });

  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const inserted = await leadService.bulkCreateLeads(req.tenantId!, site?.id ?? null, clean);
  res.json({ ok: true, count: inserted.length });
});
