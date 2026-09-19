// config/env.ts — single place every other file reads config from.
import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
};

if (env.isProd && env.jwtSecret === "dev-only-insecure-secret-change-me") {
  throw new Error("JWT_SECRET must be set in production.");
}
