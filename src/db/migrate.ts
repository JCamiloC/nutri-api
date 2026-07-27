import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "../../sql/001_init.sql");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: databaseUrl });

async function main() {
  await client.connect();
  console.log(`[migrate] connected → applying ${path.basename(sqlPath)}`);
  await client.query(sql);
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  console.log("[migrate] tables:", tables.rows.map((r) => r.table_name).join(", "));
  await client.end();
  console.log("[migrate] done");
}

main().catch(async (error) => {
  console.error("[migrate] failed:", error instanceof Error ? error.message : error);
  try {
    await client.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
