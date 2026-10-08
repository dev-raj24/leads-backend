import type { Request, Response } from "express";
import * as followupService from "../services/followup.service";
import * as mailer from "../services/mailer.service";
import { asyncHandler } from "../utils/asyncHandler";
import { htmlPage } from "../utils/htmlPage";

const invalid = () => htmlPage("Link not valid", "<h1>This link isn't valid</h1><p>It may have been copied incorrectly.</p>");

/** GET /api/public/followup-skip?t= — confirmation page, so mail scanners that open links don't cancel anything. */
export const confirmPage = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  if (!mailer.parseFollowupSkipToken(token)) return res.status(400).type("html").send(invalid());
  res.type("html").send(
    htmlPage(
      "Stop this follow-up",
      `<h1>Stop this follow-up?</h1><p>It will not be sent. You can schedule another one from the lead's page any time.</p><form method="post" action="/api/public/followup-skip?t=${encodeURIComponent(token)}"><button type="submit">Yes, stop it</button></form>`
    )
  );
});

/** POST /api/public/followup-skip?t= */
export const perform = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  const id = mailer.parseFollowupSkipToken(token);
  if (!id) return res.status(400).type("html").send(invalid());
  const stopped = await followupService.skipFollowupById(id);
  res.type("html").send(
    htmlPage(stopped ? "Stopped" : "Already handled", stopped ? "<h1>Follow-up stopped</h1><p>Nothing will be sent to that customer.</p>" : "<h1>Nothing to stop</h1><p>That follow-up was already sent or cancelled.</p>")
  );
});
