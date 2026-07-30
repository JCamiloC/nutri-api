import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { mapIngredient, resolveLabId } from "../lib/mappers.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";

export const ingredientsRouter = Router();

function getLabId(req: Parameters<typeof resolveLabId>[0], res: { status: (n: number) => { json: (b: unknown) => unknown } }) {
  try {
    return resolveLabId(req);
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string };
    res.status(err.status ?? 403).json({
      error: err.code ?? "lab_required",
      message: err.message ?? "Laboratorio requerido",
    });
    return null;
  }
}

ingredientsRouter.get("/v1/ingredients", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
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

ingredientsRouter.get("/v1/ingredients/:id", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
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

ingredientsRouter.post("/v1/ingredients", requireAuth, requireWrite, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

  const d = parsed.data;
  const source = d.source;
  // ICBF / USDA (API) siempre auxiliares de solo lectura
  const readOnly = source !== "BD";

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

    await writeAudit(req, {
      labId,
      action: "ingredient.create",
      detail: `${source} · ${d.nombre}`,
    });

    return res.status(201).json(mapIngredient(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "create_ingredient_failed", message });
  }
});

const updateBody = createBody.omit({ source: true }).partial().extend({
  nombre: z.string().min(1).optional(),
});

ingredientsRouter.patch("/v1/ingredients/:id", requireAuth, requireWrite, async (req, res) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

  try {
    const existing = await getPool().query(
      `SELECT * FROM ingredients WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }

    const source = String(existing.rows[0].source);
    if (source === "ICBF" || source === "API" || existing.rows[0].read_only === true) {
      return res.status(403).json({
        error: "ingredient_readonly",
        message: "ICBF y USDA son auxiliares de solo lectura. Copia a BD para editar.",
      });
    }

    const d = parsed.data;
    const result = await getPool().query(
      `UPDATE ingredients SET
        nombre = COALESCE($3, nombre),
        referencia = COALESCE($4, referencia),
        grasas = COALESCE($5, grasas),
        grasa_saturada = COALESCE($6, grasa_saturada),
        grasa_mono = COALESCE($7, grasa_mono),
        grasa_poli = COALESCE($8, grasa_poli),
        grasa_trans = COALESCE($9, grasa_trans),
        colesterol = COALESCE($10, colesterol),
        sodio = COALESCE($11, sodio),
        potasio = COALESCE($12, potasio),
        carbohidratos = COALESCE($13, carbohidratos),
        fibra = COALESCE($14, fibra),
        fibra_sol = COALESCE($15, fibra_sol),
        fibra_insol = COALESCE($16, fibra_insol),
        polialcoholes = COALESCE($17, polialcoholes),
        azucar = COALESCE($18, azucar),
        azucar_add = COALESCE($19, azucar_add),
        proteina = COALESCE($20, proteina),
        energia_kcal = COALESCE($21, energia_kcal),
        vitaminas = COALESCE($22::jsonb, vitaminas),
        alergenos = COALESCE($23::jsonb, alergenos),
        updated_at = now()
      WHERE id = $1 AND lab_id = $2
      RETURNING *`,
      [
        req.params.id,
        labId,
        d.nombre ?? null,
        d.referencia ?? null,
        d.grasas ?? null,
        d.grasaSaturada ?? null,
        d.grasaMono ?? null,
        d.grasaPoli ?? null,
        d.grasaTrans ?? null,
        d.colesterol ?? null,
        d.sodio ?? null,
        d.potasio ?? null,
        d.carbohidratos ?? null,
        d.fibra ?? null,
        d.fibraSol ?? null,
        d.fibraInsol ?? null,
        d.polialcoholes ?? null,
        d.azucar ?? null,
        d.azucarAdd ?? null,
        d.proteina ?? null,
        d.energiaKcal ?? null,
        d.vitaminas ? JSON.stringify(d.vitaminas) : null,
        d.alergenos ? JSON.stringify(d.alergenos) : null,
      ],
    );

    await writeAudit(req, {
      labId,
      action: "ingredient.update",
      detail: String(result.rows[0].nombre),
    });

    return res.json(mapIngredient(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_ingredient_failed", message });
  }
});

ingredientsRouter.delete("/v1/ingredients/:id", requireAuth, requireWrite, async (req, res) => {
  const labId = getLabId(req, res);
  if (!labId) return;

  try {
    const existing = await getPool().query(
      `SELECT * FROM ingredients WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    const source = String(existing.rows[0].source);
    if (source === "ICBF" || source === "API" || existing.rows[0].read_only === true) {
      return res.status(403).json({
        error: "ingredient_readonly",
        message: "No se pueden eliminar ingredientes ICBF/USDA auxiliares",
      });
    }

    await getPool().query(`DELETE FROM ingredients WHERE id = $1 AND lab_id = $2`, [
      req.params.id,
      labId,
    ]);
    await writeAudit(req, {
      labId,
      action: "ingredient.delete",
      detail: String(existing.rows[0].nombre),
    });
    return res.json({ ok: true, id: req.params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_ingredient_failed", message });
  }
});
