// utils/validate.ts — tiny input guards shared by every controller.

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Returns the trimmed string, or undefined when the value is empty / not a string. */
export function optionalString(v: unknown): string | undefined {
  return isNonEmptyString(v) ? v.trim() : undefined;
}
