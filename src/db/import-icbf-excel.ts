/**
 * Importa BD ICBF.xlsx → icbf_foods (Postgres).
 *
 * Uso:
 *   npm run db:import-icbf-excel
 *
 * Ruta por defecto: ../../BD ICBF.xlsx (raíz Enerxis).
 * Override: $env:ICBF_EXCEL_PATH="C:\ruta\BD ICBF.xlsx"
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXCEL = path.resolve(__dirname, "../../../../BD ICBF.xlsx");
const DATA_START = 2;

const COL = {
  codigo: 0,
  fuente: 1,
  nombre: 2,
  parteAnalizada: 3,
  humedad: 4,
  energiaKcal: 5,
  proteina: 7,
  grasas: 8,
  carbohidratos: 9,
  fibra: 11,
  calcio: 13,
  hierro: 14,
  sodio: 15,
  fosforo: 16,
  yodo: 17,
  zinc: 18,
  magnesio: 19,
  potasio: 20,
  tiamina: 21,
  riboflavina: 22,
  niacina: 23,
  folatos: 24,
  vitaminaB12: 25,
  vitaminaC: 26,
  vitaminaA: 27,
  grasaSaturada: 28,
  grasaMono: 29,
  grasaPoli: 30,
  colesterol: 31,
} as const;

function num(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function n0(value: unknown): number {
  return num(value) ?? 0;
}

function buildVitaminas(row: unknown[]): Array<{ nombre: string; valor: number }> {
  const yodo = num(row[COL.yodo]);
  const entries: Array<[string, number | null]> = [
    ["Vitamina A", num(row[COL.vitaminaA])],
    ["Vitamina C", num(row[COL.vitaminaC])],
    ["Calcio", num(row[COL.calcio])],
    ["Hierro", num(row[COL.hierro])],
    ["Vitamina B1", num(row[COL.tiamina])],
    ["Vitamina B2", num(row[COL.riboflavina])],
    ["Niacina", num(row[COL.niacina])],
    ["Ácido fólico", num(row[COL.folatos])],
    ["Vitamina B12", num(row[COL.vitaminaB12])],
    ["Fósforo", num(row[COL.fosforo])],
    ["Yodo", yodo != null ? yodo * 1000 : null],
    ["Magnesio", num(row[COL.magnesio])],
    ["Zinc", num(row[COL.zinc])],
    ["Potasio", num(row[COL.potasio])],
  ];
  return entries
    .filter((entry): entry is [string, number] => entry[1] != null && entry[1] !== 0)
    .map(([nombre, valor]) => ({ nombre, valor }));
}

function buildAminoacidos(row: unknown[]): Record<string, number> | null {
  const labels = [
    "Ácido Aspártico",
    "Treonina",
    "Serina",
    "Ácido Glutámico",
    "Prolina",
    "Glicina",
    "Alanina",
    "Cisteina",
    "Valina",
    "Metionina",
    "Isoleucina",
    "Leucina",
    "Tirosina",
    "Fenilalanina",
    "Histidina",
    "Lisina",
    "Arginina",
    "Triptofano",
  ];
  const amino: Record<string, number> = {};
  labels.forEach((label, offset) => {
    const value = num(row[32 + offset]);
    if (value !== null) amino[label] = value;
  });
  return Object.keys(amino).length ? amino : null;
}

async function main() {
  const excelPath = process.env.ICBF_EXCEL_PATH?.trim() || DEFAULT_EXCEL;
  if (!fs.existsSync(excelPath)) {
    throw new Error(`No se encontró el Excel ICBF en: ${excelPath}`);
  }

  console.log(`[import-icbf-excel] leyendo ${excelPath}`);
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const records = rows
    .slice(DATA_START)
    .map((row) => {
      const codigo = String(row[COL.codigo] ?? "").trim();
      const nombre = String(row[COL.nombre] ?? "").trim();
      if (!codigo || !nombre) return null;
      return {
        codigo,
        nombre,
        parteAnalizada: String(row[COL.parteAnalizada] ?? "").trim() || null,
        fuente: String(row[COL.fuente] ?? "ICBF").trim() || "ICBF",
        humedad: num(row[COL.humedad]),
        energiaKcal: n0(row[COL.energiaKcal]),
        proteina: n0(row[COL.proteina]),
        grasas: n0(row[COL.grasas]),
        grasaSaturada: n0(row[COL.grasaSaturada]),
        grasaMono: n0(row[COL.grasaMono]),
        grasaPoli: n0(row[COL.grasaPoli]),
        colesterol: n0(row[COL.colesterol]),
        carbohidratos: n0(row[COL.carbohidratos]),
        fibra: n0(row[COL.fibra]),
        sodio: n0(row[COL.sodio]),
        potasio: n0(row[COL.potasio]),
        vitaminas: buildVitaminas(row),
        aminoacidos: buildAminoacidos(row),
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

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
  console.log(
    `[import-icbf-excel] insertados ${inserted}, actualizados ${updated}; total icbf_foods=${total.rows[0].n}`,
  );
  await pool.end();
}

main().catch(async (error) => {
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
