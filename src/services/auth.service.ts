import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { env } from "../config/env";
import { pool, query } from "../config/db";
import { badRequest, DatabaseNotConfiguredError, EmailInUseError, InvalidCredentialsError, InvalidResetTokenError } from "../utils/errors";
import * as mailer from "./mailer.service";
import { toSite, type SiteRow } from "./site.service";
import { getTenant } from "./tenant.service";
import type { AuthUser, LoginInput, Site, SignupInput, Tenant } from "../types";

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
}

const DUMMY_HASH = bcrypt.hashSync("leadworks-dummy-password", env.bcryptRounds);
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function signup(
  input: SignupInput
): Promise<{ user: AuthUser; site: Site; tenant: Tenant }> {
  if (!pool) throw new DatabaseNotConfiguredError();

  const existing = await query<{ id: string }>(`select id from users where email = $1`, [
    input.email,
  ]);
  if (existing[0]) throw new EmailInUseError();

  const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);

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
      tenant: await getTenant(tenantId),
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: LoginInput): Promise<{ user: AuthUser; tenant: Tenant }> {
  const rows = await query<UserRow>(`select * from users where email = $1 limit 1`, [
    input.email,
  ]);
  const row = rows[0];
  const ok = await bcrypt.compare(input.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new InvalidCredentialsError();

  return { user: toAuthUser(row), tenant: await getTenant(row.tenant_id) };
}

/** Always succeeds from the caller's point of view — never reveals whether the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const rows = await query<{ id: string; email: string }>(`select id, email from users where email = $1 limit 1`, [email]);
  const user = rows[0];
  if (!user) return;

  const rawToken = randomBytes(32).toString("hex");
  await query(
    `update users set reset_token_hash = $2, reset_token_expires_at = now() + $3::interval where id = $1`,
    [user.id, hashToken(rawToken), `${RESET_TOKEN_TTL_MS / 1000} seconds`]
  );

  const link = `${env.appUrl}/reset-password?token=${rawToken}`;
  await mailer.sendMail({
    to: user.email,
    subject: "Reset your Leadworks password",
    text: `We received a request to reset your password.\n\nReset it here (link expires in 30 minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const rows = await query<UserRow>(`select * from users where id = $1`, [userId]);
  const row = rows[0];
  const ok = row && (await bcrypt.compare(currentPassword, row.password_hash));
  // 400, not 401 — the request IS authenticated (valid JWT); only the body field is wrong,
  // and the frontend logs the user out on any 401 from an authenticated request.
  if (!row || !ok) throw badRequest("wrong_current_password");

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await query(`update users set password_hash = $2 where id = $1`, [userId, passwordHash]);
}

export async function changeEmail(userId: string, newEmail: string, currentPassword: string): Promise<AuthUser> {
  const rows = await query<UserRow>(`select * from users where id = $1`, [userId]);
  const row = rows[0];
  const ok = row && (await bcrypt.compare(currentPassword, row.password_hash));
  if (!row || !ok) throw badRequest("wrong_current_password");

  const existing = await query<{ id: string }>(`select id from users where email = $1 and id <> $2`, [newEmail, userId]);
  if (existing[0]) throw new EmailInUseError();

  const updated = await query<UserRow>(`update users set email = $2 where id = $1 returning *`, [userId, newEmail]);
  return toAuthUser(updated[0]);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `select id from users where reset_token_hash = $1 and reset_token_expires_at > now() limit 1`,
    [hashToken(token)]
  );
  const user = rows[0];
  if (!user) throw new InvalidResetTokenError();

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await query(
    `update users set password_hash = $2, reset_token_hash = null, reset_token_expires_at = null where id = $1`,
    [user.id, passwordHash]
  );
}
