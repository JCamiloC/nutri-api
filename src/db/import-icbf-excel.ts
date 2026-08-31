/**
 * Importa data/BD_ICBF.xlsx → icbf_foods (Postgres).
 * Celdas vacías → 0. Reemplaza el catálogo ICBF completo (TRUNCATE + insert).
 *
 *   npm run db:import-icbf-excel
 *
 * Override: ICBF_EXCEL_PATH
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompositionSheet } from "./excel-composition.js";
import { getPool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXCEL = path.resolve(__dirname, "../../data/BD_ICBF.xlsx");

export async function importIcbfExcel(options?: {
  excelPath?: string;
  endPool?: boolean;
}): Promise<{ inserted: number; updated: number; total: number }> {
  const excelPath = options?.excelPath?.trim() || process.env.ICBF_EXCEL_PATH?.trim() || DEFAULT_EXCEL;
  if (!fs.existsSync(excelPath)) {
    throw new Error(`No se encontró el Excel ICBF en: ${excelPath}`);
  }

  console.log(`[import-icbf-excel] leyendo ${excelPath}`);
  const records = readCompositionSheet(excelPath, { defaultFuente: "ICBF" });
  console.log(`[import-icbf-excel] filas válidas: ${records.length}`);

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE icbf_foods");

    for (const food of records) {
      const result = await client.query(
        `INSERT INTO icbf_foods (
          codigo, nombre, parte_analizada, fuente,
          grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
          colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
          polialcoholes, azucar, azucar_add, proteina, energia_kcal, humedad,
          vitaminas, aminoacidos
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,0,
          $9,$10,$11,$12,$13,0,0,
          0,0,0,$14,$15,$16,
          $17::jsonb,$18::jsonb
        )
        ON CONFLICT (codigo) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          parte_analizada = EXCLUDED.parte_analizada,
          fuente = EXCLUDED.fuente,
          grasas = EXCLUDED.grasas,
          grasa_saturada = EXCLUDED.grasa_saturada,
          grasa_mono = EXCLUDED.grasa_mono,
          grasa_poli = EXCLUDED.grasa_poli,
          colesterol = EXCLUDED.colesterol,
          sodio = EXCLUDED.sodio,
          potasio = EXCLUDED.potasio,
          carbohidratos = EXCLUDED.carbohidratos,
          fibra = EXCLUDED.fibra,
          proteina = EXCLUDED.proteina,
          energia_kcal = EXCLUDED.energia_kcal,
          humedad = EXCLUDED.humedad,
          vitaminas = EXCLUDED.vitaminas,
          aminoacidos = EXCLUDED.aminoacidos
        RETURNING (xmax = 0) AS inserted`,
        [
          food.codigo,
          food.nombre,
          food.parteAnalizada,
          food.fuente,
          food.grasas,
          food.grasaSaturada,
          food.grasaMono,
          food.grasaPoli,
          food.colesterol,
          food.sodio,
          food.potasio,
          food.carbohidratos,
          food.fibra,
          food.proteina,
          food.energiaKcal,
          food.humedad,
          JSON.stringify(food.vitaminas),
          JSON.stringify(food.aminoacidos),
        ],
      );
      if (result.rows[0]?.inserted) inserted += 1;
      else updated += 1;
      if ((inserted + updated) % 200 === 0) {
        console.log(`[import-icbf-excel] … ${inserted + updated}/${records.length}`);
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const total = await pool.query(`SELECT count(*)::int AS n FROM icbf_foods`);
  const n = Number(total.rows[0].n);
  console.log(
    `[import-icbf-excel] insertados ${inserted}, actualizados ${updated}; total icbf_foods=${n}`,
  );
  if (options?.endPool !== false) await pool.end();
  return { inserted, updated, total: n };
}

const isDirectRun = process.argv[1]?.includes("import-icbf-excel");
if (isDirectRun) {
  importIcbfExcel().catch(async (error) => {
    console.error(
      "[import-icbf-excel] failed:",
      error instanceof Error ? error.message : error,
    );
    try {
      await getPool().end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
