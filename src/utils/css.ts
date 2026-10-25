// utils/css.ts — owner-supplied CSS is injected into a shadow root on the owner's own site.
// It can't run script, but we still drop the constructs that could load remote CSS or break out of <style>.

const FORBIDDEN = [/@import[^;]*;?/gi, /<\/?style[^>]*>/gi, /<script[\s\S]*?>/gi, /expression\s*\(/gi, /javascript:/gi, /behavior\s*:/gi, /-moz-binding/gi];

export function sanitizeCss(raw: unknown, maxLength = 5000): string {
  if (typeof raw !== "string") return "";
  let css = raw.slice(0, maxLength);
  for (const pattern of FORBIDDEN) css = css.replace(pattern, "");
  return css.trim();
}
