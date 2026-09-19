// services/auth.service.ts — business logic + RAW SQL.
// Rule: raw SQL lives ONLY here. Every query is parametrized.
//
// Signup creates a tenant + a default site (for the widget api_key) + an
// ai_config row + the owner user, in one flow, so a new signup lands with
// everything the rest of the product needs already in place.

import bcrypt from "bcryptjs";
import { pool, query } from "../config/db";
import { DatabaseNotConfiguredError, EmailInUseError, InvalidCredentialsError } from "../utils/errors";
import { toSite, type SiteRow } from "./site.service";
import type { AuthUser, LoginInput, Site, SignupInput } from "../types";

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role };
}

export async function signup(
  input: SignupInput
): Promise<{ user: AuthUser; site: Site }> {
  if (!pool) throw new DatabaseNotConfiguredError();

  const existing = await query<{ id: string }>(`select id from users where email = $1`, [
    input.email,
  ]);
  if (existing[0]) throw new EmailInUseError();

  const passwordHash = await bcrypt.hash(input.password, 10);

  // Everything below belongs to one signup — run it as a single transaction
  // so a half-created tenant never gets left behind on failure.
  const client = await pool.connect();
  try {
    await client.query("begin");

    const tenantRows = await client.query<{ id: string }>(
      `insert into tenants (name) values ($1) returning id`,
      [input.businessName]
    );
    const tenantId = tenantRows.rows[0].id;

    const userRows = await client.query<UserRow>(
      `insert into users (tenant_id, email, password_hash, role)
       values ($1, $2, $3, 'owner')
       returning *`,
      [tenantId, input.email, passwordHash]
    );

    const siteRows = await client.query<SiteRow>(
      `insert into sites (tenant_id) values ($1) returning *`,
      [tenantId]
    );

    await client.query(
      `insert into ai_config (tenant_id, business_info) values ($1, $2::jsonb)`,
      [tenantId, JSON.stringify({ about: input.servicesInfo ?? "" })]
    );

    await client.query("commit");

    return {
      user: toAuthUser(userRows.rows[0]),
      site: toSite(siteRows.rows[0]),
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: LoginInput): Promise<AuthUser> {
  const rows = await query<UserRow>(`select * from users where email = $1 limit 1`, [
    input.email,
  ]);
  const row = rows[0];
  if (!row) throw new InvalidCredentialsError();

  const ok = await bcrypt.compare(input.password, row.password_hash);
  if (!ok) throw new InvalidCredentialsError();

  return toAuthUser(row);
}
