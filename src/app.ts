import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { limits } from "./middleware/rateLimit.middleware";
import { siteGuard } from "./middleware/site-guard.middleware";
import { apiRoutes } from "./routes";

export const app = express();

if (env.trustProxy) app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");

const openCors = cors();
const privateCors = cors({ origin: env.corsOrigins });
const EMBED_ASSETS = new Set(["/widget.js"]);
const isPublicPath = (path: string) => path.startsWith("/api/public/") || path === "/api/ingest/lead" || EMBED_ASSETS.has(path);

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
app.use(["/api/public", "/api/ingest"], siteGuard);

app.get("/health", (_req, res) => res.json({ ok: true, service: "leadworks-api" }));
// Embed assets (widget.js) — served to arbitrary customer sites, cacheable, no auth.
app.use(express.static(path.join(__dirname, "../public"), { maxAge: "5m" }));
app.use("/api", limits.api, apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
