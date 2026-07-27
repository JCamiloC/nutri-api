import "dotenv/config";
import { spawn } from "node:child_process";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nutri:nutri@127.0.0.1:5432/nutri_lab";
const maxAttempts = 30;

async function waitForDb(): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      console.log(`[db:setup] Postgres listo (intento ${attempt})`);
      return;
    } catch (error) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[db:setup] esperando Postgres (${attempt}/${maxAttempts}): ${message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Postgres no respondió a tiempo. ¿Docker Desktop está corriendo?");
}

function runMigrate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/db/migrate.ts"], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`migrate exit ${code}`));
    });
  });
}

async function main() {
  await waitForDb();
  await runMigrate();
  console.log("[db:setup] listo — DATABASE_URL=", databaseUrl);
}

main().catch((error) => {
  console.error("[db:setup] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
