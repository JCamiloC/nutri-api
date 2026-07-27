import "dotenv/config";
import { DEMO_LAB_ID } from "../config/constants.js";
import { getPool } from "./pool.js";

async function main() {
  const pool = getPool();

  const existing = await pool.query(
    `SELECT count(*)::int AS n FROM formulas WHERE lab_id = $1`,
    [DEMO_LAB_ID],
  );
  if (existing.rows[0].n > 0) {
    console.log("[seed] formulas ya existen, skip");
    await pool.end();
    return;
  }

  const proteina = await pool.query(
    `INSERT INTO ingredients (
      lab_id, source, referencia, nombre, read_only,
      grasas, grasa_saturada, carbohidratos, fibra, proteina, sodio, azucar, azucar_add, energia_kcal,
      vitaminas
    ) VALUES (
      $1, 'BD', 'PX-12', 'Concentrado proteico Enerxis PX-12', false,
      7, 3, 40, 2, 60, 317, 30, 23, 373,
      $2::jsonb
    ) RETURNING id`,
    [DEMO_LAB_ID, JSON.stringify([{ nombre: "Iron", valor: 4.2 }, { nombre: "Calcium", valor: 220 }, { nombre: "Zinc", valor: 3.1 }])],
  );

  const azucar = await pool.query(
    `INSERT INTO ingredients (
      lab_id, source, referencia, nombre, read_only,
      grasas, carbohidratos, fibra, proteina, sodio, azucar, azucar_add, energia_kcal
    ) VALUES (
      $1, 'ICBF', 'AZ-01', 'Azúcar blanca', true,
      0, 100, 0, 0, 0, 100, 100, 400
    ) RETURNING id`,
    [DEMO_LAB_ID],
  );

  const formula = await pool.query(
    `INSERT INTO formulas (
      lab_id, title, product_name, brand, status,
      package_weight, weight_unit, servings, serving_size, formula_type, ingredient_count
    ) VALUES (
      $1, 'Batido proteico vainilla', 'PowerShake Vainilla', 'Andes Nutri', 'lista',
      30, 'g', 12, 30, 'Solido', 2
    ) RETURNING id`,
    [DEMO_LAB_ID],
  );

  await pool.query(
    `INSERT INTO formula_lines (formula_id, ingredient_id, source, name, percent, sort_order)
     VALUES
       ($1, $2, 'BD', 'Concentrado proteico Enerxis PX-12', 60, 0),
       ($1, $3, 'ICBF', 'Azúcar blanca', 40, 1)`,
    [formula.rows[0].id, proteina.rows[0].id, azucar.rows[0].id],
  );

  console.log("[seed] ok formula=", formula.rows[0].id);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
