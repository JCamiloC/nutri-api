import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import {
  canResolveIngredientForFormula,
  ingredientVisibilitySql,
  isIngredientEditable,
  viewerFromReq,
} from "../lib/ingredient-ownership.js";
import { mapIngredient, resolveLabId } from "../lib/mappers.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";

export const ingredientsRouter = Router();

function getLabId(
  req: Parameters<typeof resolveLabId>[0],
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
) {
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
    const viewer = viewerFromReq(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
    const pool = getPool();
    const visibility = ingredientVisibilitySql(1);

    let scopeSql = "";
    const params: unknown[] = [labId];
    if (scope === "mine" && viewer) {
      params.push(viewer.id);
      scopeSql = ` AND source = 'BD' AND is_base = false AND created_by_user_id = $${params.length}`;
    } else if (scope === "base") {
      scopeSql = ` AND is_base = true`;
    } else if (scope === "others") {
      params.push(viewer?.id ?? null);
      scopeSql = ` AND source = 'BD' AND is_base = false AND (created_by_user_id IS DISTINCT FROM $${params.length})`;
    }

    if (q) {
      params.push(`%${q}%`);
      const result = await pool.query(
        `SELECT * FROM ingredients
         WHERE ${visibility}${scopeSql} AND nombre ILIKE $${params.length}
         ORDER BY is_base DESC, source ASC, nombre ASC
         LIMIT 200`,
        params,
      );
      return res.json({ items: result.rows.map((row) => mapIngredient(row, viewer)) });
    }

    const result = await pool.query(
      `SELECT * FROM ingredients
       WHERE ${visibility}${scopeSql}
       ORDER BY is_base DESC, source ASC, nombre ASC
       LIMIT 300`,
      params,
    );
    return res.json({ items: result.rows.map((row) => mapIngredient(row, viewer)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_ingredients_failed", message });
  }
});

ingredientsRouter.get("/v1/ingredients/:id", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const viewer = viewerFromReq(req);
    const result = await getPool().query(`SELECT * FROM ingredients WHERE id = $1`, [
      req.params.id,
    ]);
    const row = result.rows[0];
    if (!row || !canResolveIngredientForFormula(row, labId)) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(mapIngredient(row, viewer));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_ingredient_failed", message });
  }
});

const createBody = z.object({
  source: z.enum(["ICBF", "BD", "API"]).default("BD"),
  nombre: z.string().min(1),
  referencia: z.string().optional().nullable(),
  tipo: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  unidadMedida: z.string().optional().nullable(),
  costo: z.number().optional(),
  proveedor: z.string().optional().nullable(),
  parteAnalizada: z.string().optional().nullable(),
  humedad: z.number().optional().nullable(),
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
  const viewer = viewerFromReq(req);
  if (!viewer) return res.status(401).json({ error: "unauthorized" });

  const d = parsed.data;
  // Clientes solo crean BD propios (editables). ICBF/API van por catalog/attach.
  const source = "BD";
  const readOnly = false;

  try {
    const result = await getPool().query(
      `INSERT INTO ingredients (
        lab_id, source, referencia, nombre, read_only, is_base, created_by_user_id,
        tipo, estado, unidad_medida, costo, proveedor, parte_analizada, humedad,
        grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
        colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
        polialcoholes, azucar, azucar_add, proteina, energia_kcal,
        vitaminas, alergenos
      ) VALUES (
        $1,$2,$3,$4,$5,false,$6,
        $7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,
        $26,$27,$28,$29,$30,
        $31::jsonb,$32::jsonb
      ) RETURNING *`,
      [
        labId,
        source,
        d.referencia ?? null,
        d.nombre,
        readOnly,
        viewer.id,
        d.tipo ?? "MATERIA PRIMA",
        d.estado ?? "POLVO",
        d.unidadMedida ?? "g",
        d.costo ?? 0,
        d.proveedor ?? null,
        d.parteAnalizada ?? null,
        d.humedad ?? null,
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

    return res.status(201).json(mapIngredient(result.rows[0], viewer));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "create_ingredient_failed", message });
  }
});

ingredientsRouter.post(
  "/v1/ingredients/:id/duplicate",
  requireAuth,
  requireWrite,
  async (req, res) => {
    const labId = getLabId(req, res);
    if (!labId) return;
    const viewer = viewerFromReq(req);
    if (!viewer) return res.status(401).json({ error: "unauthorized" });

    try {
      const existing = await getPool().query(`SELECT * FROM ingredients WHERE id = $1`, [
        req.params.id,
      ]);
      const src = existing.rows[0];
      if (!src || !canResolveIngredientForFormula(src, labId)) {
        return res.status(404).json({ error: "not_found" });
      }

      const baseName = String(src.nombre ?? "Ingrediente");
      const copyName = `${baseName} (copia)`;

      const result = await getPool().query(
        `INSERT INTO ingredients (
          lab_id, source, referencia, nombre, read_only, is_base,
          created_by_user_id, copied_from_id,
          tipo, estado, unidad_medida, costo, proveedor, parte_analizada, humedad,
          grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
          colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
          polialcoholes, azucar, azucar_add, proteina, energia_kcal,
          vitaminas, alergenos, aminoacidos
        )
        SELECT
          $1, 'BD', referencia, $2, false, false,
          $3, id,
          tipo, estado, unidad_medida, costo, proveedor, parte_analizada, humedad,
          grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
          colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
          polialcoholes, azucar, azucar_add, proteina, energia_kcal,
          vitaminas, alergenos, aminoacidos
        FROM ingredients WHERE id = $4
        RETURNING *`,
        [labId, copyName, viewer.id, src.id],
      );

      await writeAudit(req, {
        labId,
        action: "ingredient.duplicate",
        detail: `${baseName} → ${copyName}`,
      });

      return res.status(201).json(mapIngredient(result.rows[0], viewer));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "duplicate_ingredient_failed", message });
    }
  },
);

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
  const viewer = viewerFromReq(req);
  if (!viewer) return res.status(401).json({ error: "unauthorized" });

  try {
    const existing = await getPool().query(`SELECT * FROM ingredients WHERE id = $1`, [
      req.params.id,
    ]);
    const row = existing.rows[0];
    if (!row) {
      return res.status(404).json({ error: "not_found" });
    }

    if (!isIngredientEditable(row, viewer)) {
      if (row.is_base === true) {
        return res.status(403).json({
          error: "ingredient_base_readonly",
          message:
            "La base Enerxis solo la edita el equipo Enerxis. Duplica el ingrediente para personalizarlo.",
        });
      }
      return res.status(403).json({
        error: "ingredient_not_owner",
        message:
          "Solo puedes editar ingredientes creados por ti. Duplica este para personalizarlo.",
      });
    }

    const d = parsed.data;
    const result = await getPool().query(
      `UPDATE ingredients SET
        nombre = COALESCE($2, nombre),
        referencia = COALESCE($3, referencia),
        tipo = COALESCE($4, tipo),
        estado = COALESCE($5, estado),
        unidad_medida = COALESCE($6, unidad_medida),
        costo = COALESCE($7, costo),
        proveedor = COALESCE($8, proveedor),
        parte_analizada = COALESCE($9, parte_analizada),
        humedad = COALESCE($10, humedad),
        grasas = COALESCE($11, grasas),
        grasa_saturada = COALESCE($12, grasa_saturada),
        grasa_mono = COALESCE($13, grasa_mono),
        grasa_poli = COALESCE($14, grasa_poli),
        grasa_trans = COALESCE($15, grasa_trans),
        colesterol = COALESCE($16, colesterol),
        sodio = COALESCE($17, sodio),
        potasio = COALESCE($18, potasio),
        carbohidratos = COALESCE($19, carbohidratos),
        fibra = COALESCE($20, fibra),
        fibra_sol = COALESCE($21, fibra_sol),
        fibra_insol = COALESCE($22, fibra_insol),
        polialcoholes = COALESCE($23, polialcoholes),
        azucar = COALESCE($24, azucar),
        azucar_add = COALESCE($25, azucar_add),
        proteina = COALESCE($26, proteina),
        energia_kcal = COALESCE($27, energia_kcal),
        vitaminas = COALESCE($28::jsonb, vitaminas),
        alergenos = COALESCE($29::jsonb, alergenos),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [
        req.params.id,
        d.nombre ?? null,
        d.referencia === undefined ? null : d.referencia,
        d.tipo ?? null,
        d.estado ?? null,
        d.unidadMedida ?? null,
        d.costo ?? null,
        d.proveedor === undefined ? null : d.proveedor,
        d.parteAnalizada === undefined ? null : d.parteAnalizada,
        d.humedad === undefined ? null : d.humedad,
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

    return res.json(mapIngredient(result.rows[0], viewer));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_ingredient_failed", message });
  }
});

ingredientsRouter.delete("/v1/ingredients/:id", requireAuth, requireWrite, async (req, res) => {
  const labId = getLabId(req, res);
  if (!labId) return;
  const viewer = viewerFromReq(req);
  if (!viewer) return res.status(401).json({ error: "unauthorized" });

  try {
    const existing = await getPool().query(`SELECT * FROM ingredients WHERE id = $1`, [
      req.params.id,
    ]);
    const row = existing.rows[0];
    if (!row) {
      return res.status(404).json({ error: "not_found" });
    }
    if (row.is_base === true) {
      return res.status(403).json({
        error: "ingredient_base_readonly",
        message: "No se puede eliminar la base Enerxis",
      });
    }
    if (!isIngredientEditable(row, viewer)) {
      return res.status(403).json({
        error: "ingredient_not_owner",
        message: "Solo puedes eliminar ingredientes creados por ti",
      });
    }

    await getPool().query(`DELETE FROM ingredients WHERE id = $1`, [req.params.id]);
    await writeAudit(req, {
      labId,
      action: "ingredient.delete",
      detail: String(row.nombre),
    });
    return res.json({ ok: true, id: req.params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_ingredient_failed", message });
  }
});
