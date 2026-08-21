import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Migrator con tracking en `schema_migrations`.
 *
 * Bootstrap (opción B — entornos ya poblados):
 * Si la tabla de tracking está vacía pero ya existe schema de app (`labs`),
 * registra los `.sql` actuales como aplicados SIN re-ejecutarlos.
 * Así no se toca data existente y solo corren archivos nuevos a partir de ahí.
 *
 * BD vacía: aplica todos los `.sql` en orden alfabético.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, "../../sql");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });

function listSqlFiles(): string[] {
  if (!fs.existsSync(sqlDir)) {
    return [];
  }
  return fs
    .readdirSync(sqlDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function ensureMigrationsTable(): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedIds(): Promise<Set<string>> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM schema_migrations`,
  );
  return new Set(result.rows.map((row) => row.id));
}

/** Heurística segura: schema app ya presente (post-001_init o similar). */
async function hasLegacyAppSchema(): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'labs'
    ) AS exists
  `);
  return Boolean(result.rows[0]?.exists);
}

/**
 * Primera corrida en BD ya poblada sin tracking:
 * marca los SQL actuales como applied sin ejecutarlos.
 */
async function bootstrapExisting(files: string[]): Promise<void> {
  console.log(
    "[migrate] bootstrap: BD poblada sin schema_migrations — registrando solo 001_*.sql; el resto se ejecutará",
  );
  await client.query("BEGIN");
  try {
    for (const id of files) {
      await client.query(
        `INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [id],
      );
      console.log(`[migrate] bootstrap marked ${id}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applyOne(id: string): Promise<void> {
  const fullPath = path.join(sqlDir, id);
  const sql = fs.readFileSync(fullPath, "utf8");
  console.log(`[migrate] applying ${id}`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  await client.connect();
  console.log("[migrate] connected");

  await ensureMigrationsTable();

  const files = listSqlFiles();
  if (files.length === 0) {
    console.log("[migrate] no sql/*.sql files found");
    await client.end();
    console.log("[migrate] done");
    return;
  }

  let applied = await getAppliedIds();

  if (applied.size === 0 && (await hasLegacyAppSchema())) {
    const bootstrapIds = files.filter((id) => id.startsWith("001_"));
    await bootstrapExisting(bootstrapIds.length ? bootstrapIds : [files[0]]);
    applied = await getAppliedIds();
  }

  for (const id of files) {
    if (applied.has(id)) {
      console.log(`[migrate] skip ${id} (already applied)`);
      continue;
    }
    await applyOne(id);
  }

  await client.end();
  console.log("[migrate] done");
}

main().catch(async (error) => {
  console.error(
    "[migrate] failed:",
    error instanceof Error ? error.message : error,
  );
  try {
    await client.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
