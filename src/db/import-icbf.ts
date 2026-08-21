/**
 * Importa icbf_alimentos desde el MySQL de Enerxis → icbf_foods en Postgres.
 *
 * Uso (PowerShell):
 *   $env:ENERXIS_MYSQL_HOST="..."
 *   $env:ENERXIS_MYSQL_DATABASE="..."
 *   $env:ENERXIS_MYSQL_USER="..."
 *   $env:ENERXIS_MYSQL_PASSWORD="..."
 *   npm run db:import-icbf
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { num, parseVitaminas } from "../lib/catalog-profile.js";
import { getPool } from "./pool.js";

function parseJson(value: unknown, fallback: unknown) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function main() {
  const host = process.env.ENERXIS_MYSQL_HOST;
  const database = process.env.ENERXIS_MYSQL_DATABASE;
  const user = process.env.ENERXIS_MYSQL_USER;
  const password = process.env.ENERXIS_MYSQL_PASSWORD;

  if (!host || !database || !user || !password) {
    throw new Error(
      "Faltan ENERXIS_MYSQL_HOST / DATABASE / USER / PASSWORD en el entorno",
    );
  }

  console.log(`[import-icbf] conectando MySQL ${host}/${database} …`);
  const mysqlConn = await mysql.createConnection({
    host,
    database,
    user,
    password,
    connectTimeout: 20000,
  });

  const [rows] = await mysqlConn.query(`SELECT * FROM icbf_alimentos ORDER BY nombre ASC`);
  await mysqlConn.end();

  const items = rows as Array<Record<string, unknown>>;
  console.log(`[import-icbf] leídos ${items.length} alimentos`);

  const pool = getPool();
  let upserted = 0;

  for (const row of items) {
    const codigo = String(row.codigo ?? "").trim();
    const nombre = String(row.nombre ?? "").trim();
    if (!codigo || !nombre) continue;

    const vitaminas = parseVitaminas(row.vitaminas);
    const aminoacidos = parseJson(row.aminoacidos, null);

    await pool.query(
      `INSERT INTO icbf_foods (
        codigo, nombre, parte_analizada, fuente,
        grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
        colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
        polialcoholes, azucar, azucar_add, proteina, energia_kcal, humedad,
        vitaminas, aminoacidos
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,$9,
        $10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,
        $23::jsonb,$24::jsonb
      )
      ON CONFLICT (codigo) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        parte_analizada = EXCLUDED.parte_analizada,
        fuente = EXCLUDED.fuente,
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
        humedad = EXCLUDED.humedad,
        vitaminas = EXCLUDED.vitaminas,
        aminoacidos = EXCLUDED.aminoacidos`,
      [
        codigo,
        nombre,
        row.parteAnalizada ?? row.parte_analizada ?? null,
        String(row.fuente ?? "ICBF"),
        num(row.grasas),
        num(row.grasaSaturada ?? row.grasa_saturada),
        num(row.grasaMono ?? row.grasa_mono),
        num(row.grasaPoli ?? row.grasa_poli),
        num(row.grasaTrans ?? row.grasa_trans),
        num(row.colesterol),
        num(row.sodio),
        num(row.potasio),
        num(row.carbohidratos),
        num(row.fibra),
        num(row.fibraSol ?? row.fibra_sol),
        num(row.fibraInsol ?? row.fibra_insol),
        num(row.polialcoholes),
        num(row.azucar),
        num(row.azucarAdd ?? row.azucar_add),
        num(row.proteina),
        num(row.energiaKcal ?? row.energia_kcal),
        row.humedad == null ? null : num(row.humedad),
        JSON.stringify(vitaminas),
        JSON.stringify(aminoacidos),
      ],
    );
    upserted += 1;
  }

  const total = await pool.query(`SELECT count(*)::int AS n FROM icbf_foods`);
  console.log(`[import-icbf] upsert ${upserted}; total icbf_foods=${total.rows[0].n}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[import-icbf] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
