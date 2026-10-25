import { sendHeadsUps } from "../services/followup-heads-up.service";
import { runDueFollowups } from "../services/followup-runner.service";

const INTERVAL_MS = 60_000;

export function startJobs(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendHeadsUps();
      await runDueFollowups();
    } catch (err) {
      console.error("[jobs]", err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, INTERVAL_MS).unref();
}
