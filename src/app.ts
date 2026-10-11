import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { limits } from "./middleware/rateLimit.middleware";
import { apiRoutes } from "./routes";

export const app = express();

if (env.trustProxy) app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");

const openCors = cors();
const privateCors = cors({ origin: env.corsOrigins });
const isPublicPath = (path: string) => path.startsWith("/api/public/") || path === "/api/ingest/lead";

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use((req, res, next) => (isPublicPath(req.path) ? openCors : privateCors)(req, res, next));
const keepRawBody = (req: unknown, _res: unknown, buf: Buffer) => {
  (req as express.Request).rawBody = buf;
};
app.use("/api/public/inbound-email", express.json({ limit: "1mb", verify: keepRawBody }));
app.use(["/api/public", "/api/ingest"], express.json({ limit: "32kb", verify: keepRawBody }));
app.use(express.json({ limit: "1mb", verify: keepRawBody }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "leadworks-api" }));
app.use("/api", limits.api, apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
