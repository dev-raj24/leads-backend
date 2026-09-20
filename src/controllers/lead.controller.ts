// controllers/lead.controller.ts — req/res + input validation only.
// Rule: NO SQL here. Calls services; errors flow to error.middleware.

import type { Request, Response } from "express";
import * as aiService from "../services/ai.service";
import * as alertService from "../services/alert.service";
import * as followupService from "../services/followup.service";
import * as autoReplyService from "../services/autoreply.service";
import * as leadService from "../services/lead.service";
import * as messageService from "../services/message.service";
import * as leadImportService from "../services/lead-import.service";
import * as siteService from "../services/site.service";
import { LEAD_SOURCES, LEAD_STATUSES, type LeadStatus } from "../types";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength, optionalString } from "../utils/validate";

const MAX_BULK_ROWS = 1000;

const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);

/** POST /api/ingest/lead — public, called by the site widget/form with a site key. */
export const ingest = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const siteKey = body.site_key ?? body.siteKey;
  const contact = body.contact ?? body.phone ?? body.email;

  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  if (!isNonEmptyString(contact)) throw badRequest("missing_contact");
  if (isNonEmptyString(body.website)) return res.status(201).json({ ok: true });

  const { lead, tenantId, siteSettings } = await leadService.createFromSite({
    siteKey: limitLength(siteKey, 100, "invalid_site_key"),
    contact: limitLength(contact.trim(), 160, "contact_too_long"),
    name: limitLength(optionalString(body.name), 120, "name_too_long"),
    message: limitLength(optionalString(body.message), 2000, "message_too_long"),
  });
  alertService.notifyOwnerOfNewLead(tenantId, siteSettings, lead).catch((err) => console.error("[alert]", err));
  followupService.scheduleDefaultFollowup(lead.id).catch((err) => console.error("[followup]", err));
  const reply = await autoReplyService.replyToNewLead(tenantId, siteSettings, lead);
  res.status(201).json({ ok: true, id: lead.id, reply });
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
  const messages = await messageService.getMessagesForLead(req.tenantId!, lead.id);
  res.json({ lead, messages });
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
  if (leads.length > MAX_BULK_ROWS) throw badRequest("too_many_rows");

  const clean = leads.flatMap((l) => {
    const contact = optionalString(l?.contact);
    if (!contact) return [];
    const source = (LEAD_SOURCES as readonly string[]).includes(l?.source) ? l.source : "form";
    return [
      {
        contact: limitLength(contact, 160, "contact_too_long"),
        source,
        name: limitLength(optionalString(l.name), 120, "name_too_long"),
        message: limitLength(optionalString(l.message), 2000, "message_too_long"),
        customFields: l.customFields && typeof l.customFields === "object" ? l.customFields : undefined,
      },
    ];
  });

  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const inserted = await leadService.bulkCreateLeads(req.tenantId!, site?.id ?? null, clean);
  res.json({ ok: true, count: inserted.length });
});

export const draftReply = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.getLeadById(req.tenantId!, req.params.id);
  if (!lead) throw notFound();
  res.json({ reply: await aiService.draftLeadReply(req.tenantId!, lead) });
});
