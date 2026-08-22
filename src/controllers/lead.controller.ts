import type { Request, Response } from "express";
import { DatabaseNotConfiguredError } from "../config/db";
import * as leadService from "../services/lead.service";
import * as siteService from "../services/site.service";
import { InvalidSiteKeyError } from "../services/lead.service";
import * as xlsx from "xlsx";
import type { IngestLeadInput, LeadStatus } from "../types";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function ingest(req: Request, res: Response) {
  const body = req.body ?? {};
  const siteKey = body.site_key ?? body.siteKey;
  const contact = body.contact ?? body.phone ?? body.email;

  if (!isNonEmptyString(siteKey)) {
    return res.status(400).json({ error: "missing_site_key" });
  }
  if (!isNonEmptyString(contact)) {
    return res.status(400).json({ error: "missing_contact" });
  }

  const input: IngestLeadInput = {
    siteKey,
    contact,
    name: isNonEmptyString(body.name) ? body.name : undefined,
    message: isNonEmptyString(body.message) ? body.message : undefined,
  };

  try {
    const lead = await leadService.createFromSite(input);
    return res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    return handleError(res, err, "lead.controller.ingest");
  }
}

export async function list(req: Request, res: Response) {
  const tenantId = req.tenantId;
  const status = req.query.status as LeadStatus | undefined;

  if (!isNonEmptyString(tenantId)) {
    return res.status(401).json({ error: "missing_tenant" });
  }

  try {
    const leads = await leadService.getLeadsForTenant(tenantId, status);
    return res.json({ leads });
  } catch (err) {
    return handleError(res, err, "lead.controller.list");
  }
}

/** GET /api/leads/:id */
export async function getOne(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!isNonEmptyString(tenantId)) {
    return res.status(401).json({ error: "missing_tenant" });
  }
  try {
    const lead = await leadService.getLeadById(tenantId, req.params.id);
    if (!lead) return res.status(404).json({ error: "not_found" });
    return res.json({ lead });
  } catch (err) {
    return handleError(res, err, "lead.controller.getOne");
  }
}

/** PATCH /api/leads/:id — { status } */
export async function updateStatus(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!isNonEmptyString(tenantId)) {
    return res.status(401).json({ error: "missing_tenant" });
  }
  const status = req.body?.status as LeadStatus;
  if (!isNonEmptyString(status)) {
    return res.status(400).json({ error: "missing_status" });
  }
  try {
    const lead = await leadService.updateLeadStatus(tenantId, req.params.id, status);
    if (!lead) return res.status(404).json({ error: "not_found" });
    return res.json({ lead });
  } catch (err) {
    return handleError(res, err, "lead.controller.updateStatus");
  }
}

/** GET /api/leads/template */
export async function downloadTemplate(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!isNonEmptyString(tenantId)) return res.status(401).json({ error: "missing_tenant" });

  try {
    const site = await siteService.getPrimarySiteForTenant(tenantId);
    let extraFields: string[] = [];
    if (site?.settings?.leadFields && Array.isArray(site.settings.leadFields)) {
      extraFields = site.settings.leadFields.map((f: any) => f.name);
    }
    
    // Default columns
    const columns = ["Name", "Contact*", "Message", "Source", ...extraFields];
    
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([columns]);
    
    // Add some column widths for better UX
    ws["!cols"] = columns.map(c => ({ wch: c.length < 15 ? 15 : c.length + 5 }));
    
    xlsx.utils.book_append_sheet(wb, ws, "Leads Template");
    
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    
    res.setHeader("Content-Disposition", 'attachment; filename="leads_template.xlsx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    return handleError(res, err, "lead.controller.downloadTemplate");
  }
}

/** POST /api/leads/upload-preview */
export async function uploadPreview(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!isNonEmptyString(tenantId)) return res.status(401).json({ error: "missing_tenant" });

  if (!req.file) {
    return res.status(400).json({ error: "missing_file" });
  }

  try {
    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return res.status(400).json({ error: "empty_excel" });

    // Raw row objects (keys are headers from row 1)
    const rawData = xlsx.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
    
    let validCount = 0;
    let invalidCount = 0;
    const processedRows = [];
    
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const errors: string[] = [];
      
      // Look for standard fields, case-insensitive
      const getField = (keys: string[]) => {
        const foundKey = Object.keys(row).find(k => keys.some(key => k.toLowerCase().startsWith(key)));
        return foundKey ? row[foundKey] : undefined;
      };

      const name = getField(["name"]);
      const contact = getField(["contact"]);
      const message = getField(["message"]);
      const sourceRaw = getField(["source"]);
      
      if (!isNonEmptyString(contact)) {
        errors.push("Missing required field: Contact");
      }
      
      let source = "form";
      if (isNonEmptyString(sourceRaw)) {
        const s = sourceRaw.toLowerCase();
        if (["form", "chat_widget", "whatsapp", "missed_call"].includes(s)) {
          source = s;
        } else {
          errors.push("Invalid source. Must be one of: form, chat_widget, whatsapp, missed_call");
        }
      }
      
      // Collect extra fields
      const customFields: Record<string, any> = {};
      const standardKeys = ["name", "contact", "message", "source"];
      for (const key of Object.keys(row)) {
        if (!standardKeys.some(sk => key.toLowerCase().startsWith(sk))) {
          if (row[key] !== "") {
            customFields[key] = row[key];
          }
        }
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++; else invalidCount++;
      
      processedRows.push({
        rowNumber: i + 2, // +2 because 0-indexed and row 1 is header
        isValid,
        errors,
        data: {
          name: isNonEmptyString(name) ? String(name).trim() : undefined,
          contact: isNonEmptyString(contact) ? String(contact).trim() : "",
          message: isNonEmptyString(message) ? String(message).trim() : undefined,
          source,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined
        }
      });
    }

    return res.json({
      total: processedRows.length,
      validCount,
      invalidCount,
      rows: processedRows
    });
  } catch (err) {
    return handleError(res, err, "lead.controller.uploadPreview");
  }
}

/** POST /api/leads/bulk */
export async function bulkIngest(req: Request, res: Response) {
  const tenantId = req.tenantId;
  if (!isNonEmptyString(tenantId)) return res.status(401).json({ error: "missing_tenant" });
  
  const leads = req.body.leads;
  if (!Array.isArray(leads)) {
    return res.status(400).json({ error: "invalid_payload", detail: "Expected { leads: [...] }" });
  }

  try {
    const site = await siteService.getPrimarySiteForTenant(tenantId);
    // If they have no site, we can't tie it to a site_id, but site_id is nullable anyway.
    const siteId = site?.id ?? null;

    const inserted = await leadService.bulkCreateLeads(tenantId, siteId as string, leads);
    return res.json({ ok: true, count: inserted.length });
  } catch (err) {
    return handleError(res, err, "lead.controller.bulkIngest");
  }
}

function handleError(res: Response, err: unknown, where: string) {
  if (err instanceof InvalidSiteKeyError) {
    return res.status(401).json({ error: "invalid_site_key" });
  }
  if (err instanceof DatabaseNotConfiguredError) {
    return res.status(503).json({ error: "database_not_configured", detail: err.message });
  }
  console.error(`[${where}]`, err);
  return res.status(500).json({ error: "internal_error" });
}
