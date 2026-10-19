import { sendHeadsUps } from "../services/followup-heads-up.service";
import { runDueFollowups } from "../services/followup-runner.service";
import { captureRankSnapshot, listTrackedTenants as listRankTenants } from "../services/search-console.service";
import { listTrackedTenants as listReviewTenants, syncReviews } from "../services/google-reviews.service";

const INTERVAL_MS = 60_000;
const REVIEW_POLL_MS = 15 * 60_000;

/** Snapshots today's keyword positions once a day, for every tenant with Search Console connected. */
async function captureRankHistoryIfDue(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastRankCaptureDay === today) return;
  lastRankCaptureDay = today;
  const tenants = await listRankTenants().catch((err) => {
    console.error("[jobs] rank history list failed", err);
    return [];
  });
  for (const { tenantId } of tenants) {
    await captureRankSnapshot(tenantId).catch((err) => console.error("[jobs] rank snapshot failed", tenantId, err));
  }
}

/** Pulls in new Google reviews (and AI-drafts a reply for each) every ~15 minutes. */
async function pollReviewsIfDue(): Promise<void> {
  if (Date.now() - lastReviewPollAt < REVIEW_POLL_MS) return;
  lastReviewPollAt = Date.now();
  const tenantIds = await listReviewTenants().catch((err) => {
    console.error("[jobs] review tenant list failed", err);
    return [];
  });
  for (const tenantId of tenantIds) {
    await syncReviews(tenantId).catch((err) => console.error("[jobs] review sync failed", tenantId, err));
  }
}

let lastRankCaptureDay = "";
let lastReviewPollAt = 0;

export function startJobs(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendHeadsUps();
      await runDueFollowups();
      await captureRankHistoryIfDue();
      await pollReviewsIfDue();
    } catch (err) {
      console.error("[jobs]", err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, INTERVAL_MS).unref();
}
