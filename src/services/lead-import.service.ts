// services/lead-import.service.ts — Excel template + bulk-upload parsing.
// No SQL and no req/res: buffers in, plain data out.

import ExcelJS from "exceljs";
import { LEAD_SOURCES, type LeadSource } from "../types";
import { badRequest } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

const MAX_ROWS = 1000;
const STANDARD_KEYS = ["name", "contact", "message", "source"] as const;

export interface ImportRow {
  rowNumber: number;
  isValid: boolean;
  errors: string[];
  data: {
    name?: string;
    contact: string;
    message?: string;
    source: LeadSource;
    customFields?: Record<string, string>;
  };
}

export interface ImportPreview {
  total: number;
  validCount: number;
  invalidCount: number;
  rows: ImportRow[];
}

export async function buildTemplate(extraFields: string[]): Promise<Buffer> {
  const columns = ["Name", "Contact*", "Message", "Source", ...extraFields];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Leads Template");
  sheet.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(15, c.length + 5) }));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "");
    if ("text" in value) return String(value.text ?? "");
  }
  return String(value);
}

function isStandardKey(header: string) {
  const h = header.toLowerCase();
  return STANDARD_KEYS.some((k) => h.startsWith(k));
}

export async function parseLeadsWorkbook(buffer: Buffer): Promise<ImportPreview | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  if (sheet.rowCount > MAX_ROWS + 1) throw badRequest("too_many_rows");

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? "").trim();
  });

  const findField = (row: Record<string, string>, key: string) => {
    const header = Object.keys(row).find((h) => h.toLowerCase().startsWith(key));
    return header ? row[header] : undefined;
  };

  const rows: ImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;

    const raw: Record<string, string> = {};
    headers.forEach((header, col) => {
      if (header) raw[header] = cellToString(excelRow.getCell(col).value);
    });

    const errors: string[] = [];
    const contact = findField(raw, "contact");
    const sourceRaw = findField(raw, "source");

    if (!isNonEmptyString(contact)) errors.push("Missing required field: Contact");

    let source: LeadSource = "form";
    if (isNonEmptyString(sourceRaw)) {
      const s = sourceRaw.trim().toLowerCase();
      if ((LEAD_SOURCES as readonly string[]).includes(s)) source = s as LeadSource;
      else errors.push(`Invalid source. Must be one of: ${LEAD_SOURCES.join(", ")}`);
    }

    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isStandardKey(key) && value !== "") customFields[key] = value;
    }

    const name = findField(raw, "name");
    const message = findField(raw, "message");

    rows.push({
      rowNumber,
      isValid: errors.length === 0,
      errors,
      data: {
        name: isNonEmptyString(name) ? name.trim() : undefined,
        contact: isNonEmptyString(contact) ? contact.trim() : "",
        message: isNonEmptyString(message) ? message.trim() : undefined,
        source,
        customFields: Object.keys(customFields).length ? customFields : undefined,
      },
    });
  });

  const validCount = rows.filter((r) => r.isValid).length;
  return { total: rows.length, validCount, invalidCount: rows.length - validCount, rows };
}
