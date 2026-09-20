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
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "leadworks-api" }));
app.use("/api", limits.api, apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
