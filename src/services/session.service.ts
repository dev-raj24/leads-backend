import { query } from "../config/db";

const TTL_MS = 10_000;
const cache = new Map<string, { version: number | null; at: number }>();

export async function currentTokenVersion(userId: string, tenantId: string): Promise<number | null> {
  const key = `${userId}:${tenantId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.version;
  const rows = await query<{ token_version: number }>(`select token_version from users where id = $1 and tenant_id = $2`, [userId, tenantId]);
  const version = rows[0] ? rows[0].token_version : null;
  cache.set(key, { version, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return version;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await query<{ token_version: number }>(
    `update users set token_version = token_version + 1 where id = $1 returning token_version`,
    [userId]
  );
  for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
  return rows[0]?.token_version ?? 0;
}
