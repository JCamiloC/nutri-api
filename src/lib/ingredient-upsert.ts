import type { Pool } from "pg";
import { mapIngredient } from "./mappers.js";
import type { NutrientSnapshot } from "./catalog-profile.js";

export async function upsertReadOnlyIngredient(
  pool: Pool,
  labId: string,
  source: "ICBF" | "API",
  snapshot: NutrientSnapshot,
) {
  const existing = await pool.query(
    `SELECT id FROM ingredients
     WHERE lab_id = $1 AND source = $2 AND referencia = $3
     LIMIT 1`,
    [labId, source, snapshot.referencia],
  );

  const params = [
    labId,
    source,
    snapshot.referencia,
    snapshot.nombre,
    snapshot.parteAnalizada,
    snapshot.proveedor,
    snapshot.humedad,
    snapshot.grasas,
    snapshot.grasaSaturada,
    snapshot.grasaMono,
    snapshot.grasaPoli,
    snapshot.grasaTrans,
    snapshot.colesterol,
    snapshot.sodio,
    snapshot.potasio,
    snapshot.carbohidratos,
    snapshot.fibra,
    snapshot.fibraSol,
    snapshot.fibraInsol,
    snapshot.polialcoholes,
    snapshot.azucar,
    snapshot.azucarAdd,
    snapshot.proteina,
    snapshot.energiaKcal,
    JSON.stringify(snapshot.vitaminas ?? []),
    JSON.stringify(snapshot.aminoacidos ?? null),
  ];

  if (existing.rows[0]) {
    const updated = await pool.query(
      `UPDATE ingredients SET
        nombre = $4,
        parte_analizada = $5,
        proveedor = $6,
        humedad = $7,
        grasas = $8,
        grasa_saturada = $9,
        grasa_mono = $10,
        grasa_poli = $11,
        grasa_trans = $12,
        colesterol = $13,
        sodio = $14,
        potasio = $15,
        carbohidratos = $16,
        fibra = $17,
        fibra_sol = $18,
        fibra_insol = $19,
        polialcoholes = $20,
        azucar = $21,
        azucar_add = $22,
        proteina = $23,
        energia_kcal = $24,
        vitaminas = $25::jsonb,
        aminoacidos = $26::jsonb,
        read_only = true,
        updated_at = now()
      WHERE id = $27 AND lab_id = $1
      RETURNING *`,
      [...params, existing.rows[0].id],
    );
    return mapIngredient(updated.rows[0]);
  }

  const inserted = await pool.query(
    `INSERT INTO ingredients (
      lab_id, source, referencia, nombre, read_only,
      tipo, estado, unidad_medida, costo, proveedor, parte_analizada, humedad,
      grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
      colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
      polialcoholes, azucar, azucar_add, proteina, energia_kcal,
      vitaminas, aminoacidos
    ) VALUES (
      $1,$2,$3,$4,true,
      'MATERIA PRIMA','SOLIDO','g',0,$6,$5,$7,
      $8,$9,$10,$11,$12,
      $13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,
      $25::jsonb,$26::jsonb
    ) RETURNING *`,
    params,
  );
  return mapIngredient(inserted.rows[0]);
}
