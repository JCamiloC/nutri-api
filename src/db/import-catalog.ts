/**
 * Catálogo de producción: ICBF completo + base global Enerxis desde Excel.
 * Idempotente. Pensado para post-migrate en deploy.
 *
 *   npm run db:import-catalog
 *
 * Skip parcial:
 *   SKIP_ICBF_IMPORT=1
 *   SKIP_BASE_IMPORT=1
 */
import "dotenv/config";
import { importBaseExcel } from "./import-base-excel.js";
import { importIcbfExcel } from "./import-icbf-excel.js";
import { getPool } from "./pool.js";

async function main() {
  try {
    if (process.env.SKIP_ICBF_IMPORT !== "1") {
      console.log("[import-catalog] → ICBF");
      await importIcbfExcel({ endPool: false });
    } else {
      console.log("[import-catalog] skip ICBF (SKIP_ICBF_IMPORT=1)");
    }

    if (process.env.SKIP_BASE_IMPORT !== "1") {
      console.log("[import-catalog] → base Enerxis");
      await importBaseExcel({ endPool: false });
    } else {
      console.log("[import-catalog] skip base (SKIP_BASE_IMPORT=1)");
    }

    console.log("[import-catalog] done");
  } finally {
    await getPool().end();
  }
}

main().catch(async (error) => {
  console.error(
    "[import-catalog] failed:",
    error instanceof Error ? error.message : error,
  );
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
