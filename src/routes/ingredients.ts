import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { mapIngredient, resolveLabId } from "../lib/mappers.js";

export const ingredientsRouter = Router();

ingredientsRouter.get("/v1/ingredients", async (req, res) => {
  try {
    const labId = resolveLabId(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pool = getPool();

    const result = q
      ? await pool.query(
          `SELECT * FROM ingredients
           WHERE lab_id = $1 AND nombre ILIKE $2
           ORDER BY nombre ASC
           LIMIT 100`,
          [labId, `%${q}%`],
        )
      : await pool.query(
          `SELECT * FROM ingredients WHERE lab_id = $1 ORDER BY nombre ASC LIMIT 200`,
          [labId],
        );

    res.json({ items: result.rows.map(mapIngredient) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "list_ingredients_failed", message });
  }
});

ingredientsRouter.get("/v1/ingredients/:id", async (req, res) => {
  try {
    const labId = resolveLabId(req);
    const result = await getPool().query(
      `SELECT * FROM ingredients WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(mapIngredient(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_ingredient_failed", message });
  }
});

const createBody = z.object({
  source: z.enum(["ICBF", "BD", "API"]).default("BD"),
  nombre: z.string().min(1),
  referencia: z.string().optional(),
  readOnly: z.boolean().optional(),
  grasas: z.number().optional(),
  grasaSaturada: z.number().optional(),
  grasaMono: z.number().optional(),
  grasaPoli: z.number().optional(),
  grasaTrans: z.number().optional(),
  colesterol: z.number().optional(),
  sodio: z.number().optional(),
  potasio: z.number().optional(),
  carbohidratos: z.number().optional(),
  fibra: z.number().optional(),
  fibraSol: z.number().optional(),
  fibraInsol: z.number().optional(),
  polialcoholes: z.number().optional(),
  azucar: z.number().optional(),
  azucarAdd: z.number().optional(),
  proteina: z.number().optional(),
  energiaKcal: z.number().optional(),
  vitaminas: z.array(z.object({ nombre: z.string(), valor: z.number() })).optional(),
  alergenos: z.record(z.unknown()).optional(),
});

ingredientsRouter.post("/v1/ingredients", async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = resolveLabId(req);
  const d = parsed.data;
  const source = d.source;
  const readOnly = d.readOnly ?? source !== "BD";

  try {
    const result = await getPool().query(
      `INSERT INTO ingredients (
        lab_id, source, referencia, nombre, read_only,
        grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
        colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
        polialcoholes, azucar, azucar_add, proteina, energia_kcal,
        vitaminas, alergenos
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,
        $23::jsonb,$24::jsonb
      ) RETURNING *`,
      [
        labId,
        source,
        d.referencia ?? null,
        d.nombre,
        readOnly,
        d.grasas ?? 0,
        d.grasaSaturada ?? 0,
        d.grasaMono ?? 0,
        d.grasaPoli ?? 0,
        d.grasaTrans ?? 0,
        d.colesterol ?? 0,
        d.sodio ?? 0,
        d.potasio ?? 0,
        d.carbohidratos ?? 0,
        d.fibra ?? 0,
        d.fibraSol ?? 0,
        d.fibraInsol ?? 0,
        d.polialcoholes ?? 0,
        d.azucar ?? 0,
        d.azucarAdd ?? 0,
        d.proteina ?? 0,
        d.energiaKcal ?? 0,
        JSON.stringify(d.vitaminas ?? []),
        JSON.stringify(d.alergenos ?? {}),
      ],
    );

    return res.status(201).json(mapIngredient(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "create_ingredient_failed", message });
  }
});
