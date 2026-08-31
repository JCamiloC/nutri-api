/**
 * Alias: siembra base Enerxis desde Excel (misma fuente que producción).
 * npm run db:seed-base
 */
import "dotenv/config";
import { importBaseExcel } from "./import-base-excel.js";
import { getPool } from "./pool.js";

importBaseExcel()
  .then(() => undefined)
  .catch(async (error) => {
    console.error("[seed-base] failed:", error instanceof Error ? error.message : error);
    try {
      await getPool().end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
