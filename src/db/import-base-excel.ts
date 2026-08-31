/**
 * Importa data/BASE_ENERXIS_INGREDIENTES.xlsx → ingredients (is_base=true).
 * Base global Enerxis: lab_id NULL, editable solo por superadmin; clientes duplican.
 * Celdas vacías → 0. Upsert por referencia (no borra base añadida a mano).
 *
 *   npm run db:import-base-excel
 *
 * Override: BASE_ENERXIS_EXCEL_PATH
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompositionSheet } from "./excel-composition.js";
import { getPool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXCEL = path.resolve(
  __dirname,
  "../../data/BASE_ENERXIS_INGREDIENTES.xlsx",
);

export async function importBaseExcel(options?: {
  excelPath?: string;
  endPool?: boolean;
}): Promise<{ upserted: number; total: number }> {
  const excelPath =
    options?.excelPath?.trim() ||
    process.env.BASE_ENERXIS_EXCEL_PATH?.trim() ||
    DEFAULT_EXCEL;
  if (!fs.existsSync(excelPath)) {
    throw new Error(`No se encontró el Excel base Enerxis en: ${excelPath}`);
  }

  console.log(`[import-base-excel] leyendo ${excelPath}`);
  const records = readCompositionSheet(excelPath, {
    sheetName: /composicion/i,
    defaultFuente: "Enerxis",
  });
  console.log(`[import-base-excel] filas válidas: ${records.length}`);

  const pool = getPool();
  const client = await pool.connect();
  let upserted = 0;

  try {
    await client.query("BEGIN");

    for (const item of records) {
      await client.query(
        `INSERT INTO ingredients (
          lab_id, source, referencia, nombre, read_only, is_base, created_by_user_id,
          tipo, estado, unidad_medida, costo, proveedor, parte_analizada, humedad,
          grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
          colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
          polialcoholes, azucar, azucar_add, proteina, energia_kcal,
          vitaminas, aminoacidos, alergenos
        ) VALUES (
          NULL, 'BD', $1, $2, true, true, NULL,
          'MATERIA PRIMA', 'POLVO', 'g', 0, $3, $4, $5,
          $6, $7, $8, $9, 0,
          $10, $11, $12, $13, $14, 0, 0,
          0, 0, 0, $15, $16,
          $17::jsonb, $18::jsonb, '{}'::jsonb
        )
        ON CONFLICT (referencia) WHERE is_base = true AND referencia IS NOT NULL AND btrim(referencia) <> ''
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          read_only = true,
          is_base = true,
          lab_id = NULL,
          proveedor = EXCLUDED.proveedor,
          parte_analizada = EXCLUDED.parte_analizada,
          humedad = EXCLUDED.humedad,
          grasas = EXCLUDED.grasas,
          grasa_saturada = EXCLUDED.grasa_saturada,
          grasa_mono = EXCLUDED.grasa_mono,
          grasa_poli = EXCLUDED.grasa_poli,
          grasa_trans = EXCLUDED.grasa_trans,
          colesterol = EXCLUDED.colesterol,
          sodio = EXCLUDED.sodio,
          potasio = EXCLUDED.potasio,
          carbohidratos = EXCLUDED.carbohidratos,
          fibra = EXCLUDED.fibra,
          fibra_sol = EXCLUDED.fibra_sol,
          fibra_insol = EXCLUDED.fibra_insol,
          polialcoholes = EXCLUDED.polialcoholes,
          azucar = EXCLUDED.azucar,
          azucar_add = EXCLUDED.azucar_add,
          proteina = EXCLUDED.proteina,
          energia_kcal = EXCLUDED.energia_kcal,
          vitaminas = EXCLUDED.vitaminas,
          aminoacidos = EXCLUDED.aminoacidos,
          updated_at = now()
        RETURNING id`,
        [
          item.codigo,
          item.nombre,
          item.fuente,
          item.parteAnalizada,
          item.humedad,
          item.grasas,
          item.grasaSaturada,
          item.grasaMono,
          item.grasaPoli,
          item.colesterol,
          item.sodio,
          item.potasio,
          item.carbohidratos,
          item.fibra,
          item.proteina,
          item.energiaKcal,
          JSON.stringify(item.vitaminas),
          JSON.stringify(item.aminoacidos),
        ],
      );
      upserted += 1;
      if (upserted % 50 === 0) {
        console.log(`[import-base-excel] … ${upserted}/${records.length}`);
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const total = await pool.query(
    `SELECT count(*)::int AS n FROM ingredients WHERE is_base = true`,
  );
  const n = Number(total.rows[0].n);
  console.log(`[import-base-excel] upsert ${upserted}; total base Enerxis=${n}`);
  if (options?.endPool !== false) await pool.end();
  return { upserted, total: n };
}

const isDirectRun = process.argv[1]?.includes("import-base-excel");
if (isDirectRun) {
  importBaseExcel().catch(async (error) => {
    console.error(
      "[import-base-excel] failed:",
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
