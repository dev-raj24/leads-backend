import "dotenv/config";

const DEV_SECRET = "dev-only-insecure-secret-change-me";

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";
const jwtSecret = process.env.JWT_SECRET ?? DEV_SECRET;

if (isProd && (jwtSecret === DEV_SECRET || jwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters in production.");
}

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const env = {
  port: num(process.env.PORT, 4001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  nodeEnv,
  isProd,
  corsOrigins,
  trustProxy: process.env.TRUST_PROXY ? num(process.env.TRUST_PROXY, 1) : 0,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  smtpUrl: process.env.SMTP_URL ?? "",
  mailFrom: process.env.MAIL_FROM ?? "Leadworks <no-reply@leadworks.local>",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  jobsEnabled: process.env.JOBS !== "off" && nodeEnv !== "test",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
  rateLimits: {
    authMax: num(process.env.RATE_LIMIT_AUTH, 10),
    ingestMax: num(process.env.RATE_LIMIT_INGEST, 20),
    aiMax: num(process.env.RATE_LIMIT_AI, 20),
    apiMax: num(process.env.RATE_LIMIT_API, 300),
  },
};
