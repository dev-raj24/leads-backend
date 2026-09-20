import { badRequest } from "./errors";

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function optionalString(v: unknown): string | undefined {
  return isNonEmptyString(v) ? v.trim() : undefined;
}

export function limitLength<T extends string | undefined>(value: T, max: number, code: string): T {
  if (typeof value === "string" && value.length > max) throw badRequest(code);
  return value;
}

export function limitJsonSize(value: unknown, maxBytes: number, code: string) {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > maxBytes) throw badRequest(code);
}
