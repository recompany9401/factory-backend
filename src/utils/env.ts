import dotenv from "dotenv";

dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  JWT_SECRET: process.env.JWT_SECRET ?? "",

  PENDING_TTL_MINUTES: Number(process.env.PENDING_TTL_MINUTES ?? 15),
  PENDING_CLEANUP_INTERVAL_MINUTES: Number(
    process.env.PENDING_CLEANUP_INTERVAL_MINUTES ?? 5,
  ),

  PORTONE_API_SECRET: process.env.PORTONE_API_SECRET ?? "",
  PORTONE_WEBHOOK_SECRET: process.env.PORTONE_WEBHOOK_SECRET ?? "",
  PORTONE_STORE_ID: process.env.PORTONE_STORE_ID ?? "",
  PORTONE_CHANNEL_KEY: process.env.PORTONE_CHANNEL_KEY ?? "",
};

export function assertEnv() {
  const missing: string[] = [];

  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.JWT_SECRET) missing.push("JWT_SECRET");

  if (
    !Number.isFinite(env.PENDING_TTL_MINUTES) ||
    env.PENDING_TTL_MINUTES <= 0
  ) {
    missing.push("PENDING_TTL_MINUTES (must be a positive number)");
  }
  if (
    !Number.isFinite(env.PENDING_CLEANUP_INTERVAL_MINUTES) ||
    env.PENDING_CLEANUP_INTERVAL_MINUTES <= 0
  ) {
    missing.push(
      "PENDING_CLEANUP_INTERVAL_MINUTES (must be a positive number)",
    );
  }

  if (!env.PORTONE_API_SECRET) missing.push("PORTONE_API_SECRET");
  if (!env.PORTONE_WEBHOOK_SECRET) missing.push("PORTONE_WEBHOOK_SECRET");
  if (!env.PORTONE_STORE_ID) missing.push("PORTONE_STORE_ID");
  if (!env.PORTONE_CHANNEL_KEY) missing.push("PORTONE_CHANNEL_KEY");

  if (missing.length) {
    throw new Error(`Missing/Invalid env: ${missing.join(", ")}`);
  }
}
