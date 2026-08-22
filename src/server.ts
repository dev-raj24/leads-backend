import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { leadRoutes } from "./routes/lead.routes";
import { authRoutes } from "./routes/auth.routes";
import { siteRoutes } from "./routes/site.routes";
import { offerRoutes } from "./routes/offer.routes";
import { chatRoutes } from "./routes/chat.routes";
import { blogRoutes } from "./routes/blog.routes";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "leadworks-api" }));

app.use("/api", authRoutes);
app.use("/api", siteRoutes);
app.use("/api", leadRoutes);
app.use("/api", offerRoutes);
app.use("/api", chatRoutes);
app.use("/api", blogRoutes);

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

app.listen(env.port, () => {
  console.log(`leadworks-api listening on http://localhost:${env.port}`);
});
