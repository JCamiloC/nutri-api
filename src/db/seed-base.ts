/**
 * Siembra / actualiza la base Enerxis global (is_base=true, solo lectura).
 * npm run db:seed-base
 */
import "dotenv/config";
import { getPool } from "./pool.js";

const BASE = [
  {
    referencia: "BASE-PX-12",
    nombre: "Concentrado proteico Enerxis PX-12",
    grasas: 7,
    grasaSaturada: 3,
    carbohidratos: 40,
    fibra: 2,
    proteina: 60,
    sodio: 317,
    azucar: 30,
    azucarAdd: 23,
    energiaKcal: 373,
    vitaminas: [
      { nombre: "Iron", valor: 4.2 },
      { nombre: "Calcium", valor: 220 },
      { nombre: "Zinc", valor: 3.1 },
    ],
  },
  {
    referencia: "BASE-AVENA",
    nombre: "Avena laminada (base Enerxis)",
    grasas: 6.9,
    grasaSaturada: 1.2,
    carbohidratos: 66.3,
    fibra: 10.6,
    proteina: 16.9,
    sodio: 2,
    azucar: 0.99,
    azucarAdd: 0,
    energiaKcal: 389,
    vitaminas: [],
  },
  {
    referencia: "BASE-AZUCAR",
    nombre: "Azúcar blanca (base Enerxis)",
    grasas: 0,
    grasaSaturada: 0,
    carbohidratos: 100,
    fibra: 0,
    proteina: 0,
    sodio: 0,
    azucar: 100,
    azucarAdd: 100,
    energiaKcal: 400,
    vitaminas: [],
  },
  {
    referencia: "BASE-AGUA",
    nombre: "Agua (base Enerxis)",
    grasas: 0,
    grasaSaturada: 0,
    carbohidratos: 0,
    fibra: 0,
    proteina: 0,
    sodio: 0,
    azucar: 0,
    azucarAdd: 0,
    energiaKcal: 0,
    vitaminas: [],
  },
] as const;

async function main() {
  const pool = getPool();
  let upserted = 0;

  for (const item of BASE) {
    const result = await pool.query(
      `INSERT INTO ingredients (
        lab_id, source, referencia, nombre, read_only, is_base, created_by_user_id,
        tipo, estado, unidad_medida, costo,
        grasas, grasa_saturada, carbohidratos, fibra, proteina, sodio,
        azucar, azucar_add, energia_kcal, vitaminas
      ) VALUES (
        NULL, 'BD', $1, $2, true, true, NULL,
        'MATERIA PRIMA', 'POLVO', 'g', 0,
        $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12::jsonb
      )
      ON CONFLICT (referencia) WHERE is_base = true AND referencia IS NOT NULL AND btrim(referencia) <> ''
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        read_only = true,
        is_base = true,
        grasas = EXCLUDED.grasas,
        grasa_saturada = EXCLUDED.grasa_saturada,
        carbohidratos = EXCLUDED.carbohidratos,
        fibra = EXCLUDED.fibra,
        proteina = EXCLUDED.proteina,
        sodio = EXCLUDED.sodio,
        azucar = EXCLUDED.azucar,
        azucar_add = EXCLUDED.azucar_add,
        energia_kcal = EXCLUDED.energia_kcal,
        vitaminas = EXCLUDED.vitaminas,
        updated_at = now()
      RETURNING id`,
      [
        item.referencia,
        item.nombre,
        item.grasas,
        item.grasaSaturada,
        item.carbohidratos,
        item.fibra,
        item.proteina,
        item.sodio,
        item.azucar,
        item.azucarAdd,
        item.energiaKcal,
        JSON.stringify(item.vitaminas),
      ],
    );
    if (result.rows[0]) upserted += 1;
  }

  console.log(`[seed-base] ok · ${upserted} ingredientes base`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed-base] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
