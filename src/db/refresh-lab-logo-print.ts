/**
 * Regenera logo-print.png para labs con logo.svg (PDF / rotulado).
 * npm run db:refresh-logo-print
 */
import "dotenv/config";
import { getPool } from "./pool.js";
import { ensureLabLogoPrintPng } from "../lib/lab-logo-print.js";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; logo_ext: string | null }>(
    `SELECT id, logo_ext FROM labs WHERE logo_ext IS NOT NULL`,
  );
  let ok = 0;
  for (const row of rows) {
    const done = await ensureLabLogoPrintPng(row.id, row.logo_ext);
    if (done) ok += 1;
    console.log(row.id, row.logo_ext, done ? "logo-print.png" : "skip");
  }
  console.log(`Done. ${ok}/${rows.length} print PNG(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
