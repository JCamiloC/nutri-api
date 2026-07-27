/**
 * Importa una muestra de inventario desde el MySQL de Enerxis → Postgres local.
 *
 * Uso (PowerShell):
 *   $env:ENERXIS_MYSQL_HOST="..."
 *   $env:ENERXIS_MYSQL_DATABASE="..."
 *   $env:ENERXIS_MYSQL_USER="..."
 *   $env:ENERXIS_MYSQL_PASSWORD="..."
 *   npm run db:import-sample
 *
 * No guardes credenciales en el repo.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { DEMO_LAB_ID } from "../config/constants.js";
import { getPool } from "./pool.js";

const LIMIT = Number(process.env.IMPORT_LIMIT ?? 20);

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

  console.log(`[import] conectando MySQL ${host}/${database} …`);
  const mysqlConn = await mysql.createConnection({
    host,
    database,
    user,
    password,
    connectTimeout: 20000,
  });

  const [rows] = await mysqlConn.query(
    `SELECT *
     FROM inventario
     WHERE nombre IS NOT NULL AND TRIM(nombre) <> ''
     ORDER BY idInventario DESC
     LIMIT ?`,
    [LIMIT],
  );
  await mysqlConn.end();

  const items = rows as Array<Record<string, unknown>>;
  console.log(`[import] leídos ${items.length} ingredientes de Enerxis`);

  const pool = getPool();
  let inserted = 0;
  let skipped = 0;

  for (const row of items) {
    const nombre = String(row.nombre ?? "").trim();
    if (!nombre) {
      skipped += 1;
      continue;
    }

    const origenRaw = String(row.origen ?? "BD").toUpperCase();
    const source =
      origenRaw === "ICBF" || origenRaw === "API" || origenRaw === "BD"
        ? origenRaw
        : "BD";
    const referencia = row.referencia != null ? String(row.referencia) : null;

    const exists = await pool.query(
      `SELECT id FROM ingredients
       WHERE lab_id = $1 AND nombre = $2 AND COALESCE(referencia, '') = COALESCE($3, '')
       LIMIT 1`,
      [DEMO_LAB_ID, nombre, referencia],
    );
    if (exists.rows[0]) {
      skipped += 1;
      continue;
    }

    await pool.query(
      `INSERT INTO ingredients (
        lab_id, source, referencia, nombre, read_only,
        cantidad, unidad_medida, costo, estado, proveedor, tipo,
        grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
        colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
        polialcoholes, azucar, azucar_add, proteina, energia_kcal,
        vitaminas, alergenos
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,
        $29::jsonb,$30::jsonb
      )`,
      [
        DEMO_LAB_ID,
        source,
        referencia,
        nombre,
        source !== "BD",
        num(row.cantidad) || 100,
        String(row.unidadMedida ?? "g"),
        num(row.costo),
        String(row.estado ?? "SOLIDO"),
        row.proveedor != null ? String(row.proveedor) : null,
        String(row.tipo ?? "ACTIVO"),
        num(row.grasas),
        num(row.grasaSaturada),
        num(row.grasaMono),
        num(row.grasaPoli),
        num(row.grasaTrans),
        num(row.colesterol),
        num(row.sodio),
        num(row.potasio),
        num(row.carbohidratos),
        num(row.fibra),
        num(row.fibraSol),
        num(row.fibraInsol),
        num(row.polialcoholes),
        num(row.azucar),
        num(row.azucarAdd),
        num(row.proteina),
        num(row.energiaKcal),
        JSON.stringify(parseJson(row.vitaminas, [])),
        JSON.stringify(parseJson(row.alergenos, {})),
      ],
    );
    inserted += 1;
    console.log(`  + ${source} · ${nombre}`);
  }

  const total = await pool.query(
    `SELECT count(*)::int AS n FROM ingredients WHERE lab_id = $1`,
    [DEMO_LAB_ID],
  );
  console.log(
    `[import] listo: insertados=${inserted} omitidos=${skipped} total_lab=${total.rows[0].n}`,
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error("[import] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
