import { app } from "./app";
import { env } from "./config/env";
import { startJobs } from "./jobs";

app.listen(env.port, () => {
  console.log(`leadworks-api listening on http://localhost:${env.port}`);
  if (env.jobsEnabled) startJobs();
});
