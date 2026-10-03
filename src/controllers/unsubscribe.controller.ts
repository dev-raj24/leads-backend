import type { Request, Response } from "express";
import * as mailer from "../services/mailer.service";
import { asyncHandler } from "../utils/asyncHandler";

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ea;color:#16301f;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;padding:32px 24px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 20px;color:#4b5f52}button{background:#0b5d4b;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;

/** GET /api/public/unsubscribe?t= — confirmation page (a button, so mail scanners that open links don't opt anyone out). */
export const confirmPage = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  if (!mailer.parseUnsubscribeToken(token)) {
    return res.status(400).type("html").send(page("Link not valid", "<h1>This link isn't valid</h1><p>It may have been copied incorrectly.</p>"));
  }
  res.type("html").send(
    page(
      "Stop these emails",
      `<h1>Stop these emails?</h1><p>You won't get any more automatic messages from this business.</p><form method="post" action="/api/public/unsubscribe?t=${encodeURIComponent(token)}"><button type="submit">Yes, stop them</button></form>`
    )
  );
});

/** POST /api/public/unsubscribe?t= — also the target of the one-click List-Unsubscribe header. */
export const perform = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  const parsed = mailer.parseUnsubscribeToken(token);
  if (!parsed) {
    return res.status(400).type("html").send(page("Link not valid", "<h1>This link isn't valid</h1><p>It may have been copied incorrectly.</p>"));
  }
  await mailer.unsubscribe(parsed.tenantId, parsed.contactKey);
  res.type("html").send(page("Done", "<h1>You're unsubscribed</h1><p>No more automatic messages will be sent to you.</p>"));
});
