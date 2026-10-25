import "dotenv/config";
import bcrypt from "bcryptjs";
import { Client } from "pg";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("Usage: yarn set-password <email> <new-password>");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production.");
  if (password.length < 8 || password.length > 72) throw new Error("Password must be 8 to 72 characters.");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();
  const hash = await bcrypt.hash(password, 12);
  const res = await client.query(
    `update users
     set password_hash = $2, token_version = token_version + 1, email_verified_at = coalesce(email_verified_at, now())
     where email = $1`,
    [email.trim().toLowerCase(), hash]
  );
  await client.end();
  if (res.rowCount === 0) throw new Error(`No account with email ${email}`);
  console.log(`Password updated for ${email}. Log in at the dashboard with the new password.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
