import { config as loadDotenv } from "dotenv";

if (process.env.NODE_ENV !== "test") loadDotenv();

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
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4001}`).replace(/\/$/, ""),
  inboundEmailDomain: (process.env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase(),
  inboundEmailSecret: process.env.INBOUND_EMAIL_SECRET ?? "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    authBase: process.env.GOOGLE_AUTH_BASE ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenBase: process.env.GOOGLE_TOKEN_BASE ?? "https://oauth2.googleapis.com",
    apiBase: process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com",
    accountsBase: process.env.GOOGLE_ACCOUNTS_BASE ?? "https://mybusinessaccountmanagement.googleapis.com/v1",
    businessInfoBase: process.env.GOOGLE_BUSINESS_INFO_BASE ?? "https://mybusinessbusinessinformation.googleapis.com/v1",
    myBusinessBase: process.env.GOOGLE_MY_BUSINESS_BASE ?? "https://mybusiness.googleapis.com/v4",
  },
  redisUrl: process.env.REDIS_URL ?? "",
  quietHours: process.env.QUIET_HOURS !== "off" && nodeEnv !== "test",
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    planId: process.env.RAZORPAY_PRO_PLAN_ID ?? "",
  },
  get billingConfigured() {
    return Boolean(this.razorpay.keyId && this.razorpay.keySecret && this.razorpay.planId);
  },
  get googleConfigured() {
    return Boolean(this.google.clientId && this.google.clientSecret);
  },
  get selfServePro() {
    return !isProd && !this.billingConfigured;
  },
  jobsEnabled: process.env.JOBS !== "off" && nodeEnv !== "test",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  rateLimits: {
    authMax: num(process.env.RATE_LIMIT_AUTH, 10),
    ingestMax: num(process.env.RATE_LIMIT_INGEST, 20),
    aiMax: num(process.env.RATE_LIMIT_AI, 20),
    apiMax: num(process.env.RATE_LIMIT_API, 300),
  },
};
