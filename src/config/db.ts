// config/db.ts — PostgreSQL connection pool and query helper.
import { Pool } from "pg";
import { env } from "./env";
import { DatabaseNotConfiguredError } from "../utils/errors";

declare global {
  // eslint-disable-next-line no-var
  var __leadworksPool: Pool | undefined;
}

function createPool(): Pool | null {
  if (!env.databaseUrl) return null;
  return new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

// Reuse the pool across hot-reloads in dev
export const pool = global.__leadworksPool ?? createPool();
if (!env.isProd) global.__leadworksPool = pool ?? undefined;

/** Thin query helper every service calls. Always parametrized ($1, $2 ...). */
export async function query<T = unknown>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!pool) throw new DatabaseNotConfiguredError();
  const result = await pool.query(text, params);
  return result.rows as T[];
}
