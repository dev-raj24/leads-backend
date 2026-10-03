import path from "path";
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
const EMBED_ASSETS = new Set(["/widget.js"]);
const isPublicPath = (path: string) => path.startsWith("/api/public/") || path === "/api/ingest/lead" || EMBED_ASSETS.has(path);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use((req, res, next) => (isPublicPath(req.path) ? openCors : privateCors)(req, res, next));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "leadworks-api" }));
// Embed assets (widget.js) — served to arbitrary customer sites, cacheable, no auth.
app.use(express.static(path.join(__dirname, "../public"), { maxAge: "5m" }));
app.use("/api", limits.api, apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
