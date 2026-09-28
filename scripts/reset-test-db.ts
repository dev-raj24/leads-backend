import "dotenv/config";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!url.includes("test")) throw new Error(`Refusing to truncate a database that doesn't look like a test DB: ${url}`);

  const client = new Client({ connectionString: url });
  await client.connect();
  const exists = await client.query(`select 1 from information_schema.tables where table_name = 'tenants'`);
  if (exists.rows.length > 0) {
    await client.query(`truncate table tenants restart identity cascade`);
    console.log("test database wiped");
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
