import type { Request, Response } from "express";
import * as mailer from "../services/mailer.service";
import { htmlPage } from "../utils/htmlPage";
import { asyncHandler } from "../utils/asyncHandler";

const page = htmlPage;

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
