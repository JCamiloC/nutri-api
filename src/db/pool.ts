import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!env.databaseUrl) {
    throw new Error(
      "DATABASE_URL no está configurada. Copia .env.example → .env y levanta Postgres.",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}

export async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  if (!env.databaseUrl) {
    return { ok: false, detail: "DATABASE_URL vacía" };
  }
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query("SELECT 1 AS ok");
      return { ok: result.rows[0]?.ok === 1, detail: "connected" };
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: message };
  }
}
