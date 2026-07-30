import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { validateFormulaDraft } from "../lib/formula-validation.js";
import { ingredientToPer100g } from "../lib/ingredient-profile.js";
import { mapFormula, mapFormulaLine, resolveLabId } from "../lib/mappers.js";
import { getLabCapacity } from "../lib/quota.js";
import { labLogoPublicPath } from "../lib/uploads.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";
import {
  recalculateFormula,
  type FormulaType,
  type IngredientSource,
} from "../nutrition-engine/index.js";

export const formulasRouter = Router();

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

async function loadLabBranding(
  labId: string,
  req: { protocol: string; get: (h: string) => string | undefined },
) {
  const lab = await getPool().query(`SELECT * FROM labs WHERE id = $1`, [labId]);
  const row = lab.rows[0];
  if (!row) return null;
  const logoPath = labLogoPublicPath(labId, row.logo_ext as string | null);
  const host = req.get("host");
  const base = host ? `${req.protocol}://${host}` : "";
  return {
    name: row.name as string,
    logoUrl: logoPath ? `${base}${logoPath}` : null,
    watermarkDefault: row.watermark_default !== false,
    manufacturedByDefault: (row.manufactured_by_default as string | null) ?? null,
    manufacturedForDefault: (row.manufactured_for_default as string | null) ?? null,
  };
}

formulasRouter.get("/v1/formulas", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const formulas = await pool.query(
      `SELECT * FROM formulas WHERE lab_id = $1 ORDER BY updated_at DESC`,
      [labId],
    );

    const withSources = await Promise.all(
      formulas.rows.map(async (row) => {
        const lines = await pool.query(
          `SELECT source FROM formula_lines WHERE formula_id = $1`,
          [row.id],
        );
        const sources = [...new Set(lines.rows.map((l) => l.source as string))];
        return {
          ...mapFormula(row),
          sources,
        };
      }),
    );

    res.json({ items: withSources });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "list_formulas_failed", message });
  }
});

formulasRouter.get("/v1/formulas/:id", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const formula = await pool.query(
      `SELECT * FROM formulas WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!formula.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }

    const lines = await pool.query(
      `SELECT * FROM formula_lines WHERE formula_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [req.params.id],
    );

    return res.json({
      ...mapFormula(formula.rows[0]),
      lines: lines.rows.map(mapFormulaLine),
      labBranding: await loadLabBranding(labId, req),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_formula_failed", message });
  }
});

const createBody = z.object({
  title: z.string().min(1),
  productName: z.string().optional(),
  brand: z.string().optional(),
  status: z.enum(["borrador", "lista", "exportada"]).optional(),
  packageWeight: z.number().positive().optional(),
  weightUnit: z.string().optional(),
  servings: z.number().positive().optional(),
  servingSize: z.number().positive().optional(),
  reconstitutedServing: z.number().nonnegative().optional(),
  waterPerServing: z.number().nonnegative().optional(),
  formulaType: z.enum(["Solido", "Liquido", "Reconstituida"]).optional(),
  showLogo: z.boolean().optional(),
  showWatermark: z.boolean().optional(),
  manufacturedBy: z.string().optional().nullable(),
  manufacturedFor: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        source: z.enum(["ICBF", "BD", "API"]),
        name: z.string().min(1),
        percent: z.number().min(0),
        ingredientId: z.string().uuid().optional().nullable(),
        externalRef: z.string().optional().nullable(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
});

formulasRouter.post("/v1/formulas", requireAuth, requireWrite, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

  const data = parsed.data;
  const lines = data.lines ?? [];
  const issues = validateFormulaDraft({
    title: data.title,
    formulaType: data.formulaType ?? "Solido",
    lines,
    requireLines: false,
    requireCompletePercent: lines.length > 0,
  });
  if (issues.length) {
    return res.status(400).json({ error: "validation_failed", issues });
  }

  // Título único por lab
  const dup = await getPool().query(
    `SELECT id FROM formulas WHERE lab_id = $1 AND lower(title) = lower($2) LIMIT 1`,
    [labId, data.title.trim()],
  );
  if (dup.rows[0]) {
    return res.status(409).json({
      error: "title_duplicate",
      message: "Ya existe una fórmula con ese título en este laboratorio",
    });
  }

  const capacity = await getLabCapacity(labId);
  if (!capacity || capacity.remaining <= 0) {
    return res.status(403).json({
      error: "quota_exceeded",
      message: `Cupo de tablas agotado (${capacity?.used ?? 0}/${capacity?.total ?? 0}). Solicita un pack extra o un plan superior.`,
      capacity,
    });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const labMeta = await client.query(
      `SELECT watermark_default, manufactured_by_default, manufactured_for_default
       FROM labs WHERE id = $1`,
      [labId],
    );
    const lab = labMeta.rows[0] ?? {};

    const insert = await client.query(
      `INSERT INTO formulas (
        lab_id, title, product_name, brand, status,
        package_weight, weight_unit, servings, serving_size,
        reconstituted_serving, water_per_serving, formula_type, ingredient_count,
        show_logo, show_watermark, manufactured_by, manufactured_for
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        labId,
        data.title,
        data.productName ?? null,
        data.brand ?? null,
        data.status ?? "borrador",
        data.packageWeight ?? 100,
        data.weightUnit ?? "g",
        data.servings ?? 1,
        data.servingSize ?? 1,
        data.reconstitutedServing ?? 0,
        data.waterPerServing ?? 0,
        data.formulaType ?? "Solido",
        lines.length,
        data.showLogo ?? true,
        data.showWatermark ?? (lab.watermark_default !== false),
        data.manufacturedBy ?? lab.manufactured_by_default ?? null,
        data.manufacturedFor ?? lab.manufactured_for_default ?? null,
      ],
    );

    const formula = insert.rows[0];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await client.query(
        `INSERT INTO formula_lines (
          formula_id, ingredient_id, source, external_ref, name, percent, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          formula.id,
          line.ingredientId ?? null,
          line.source,
          line.externalRef ?? null,
          line.name,
          line.percent,
          line.sortOrder ?? i,
        ],
      );
    }

    await client.query("COMMIT");

    const savedLines = await pool.query(
      `SELECT * FROM formula_lines WHERE formula_id = $1 ORDER BY sort_order ASC`,
      [formula.id],
    );

    await writeAudit(req, {
      labId,
      action: "formula.create",
      detail: data.title,
    });

    return res.status(201).json({
      ...mapFormula(formula),
      lines: savedLines.rows.map(mapFormulaLine),
      labBranding: await loadLabBranding(labId, req),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "create_formula_failed", message });
  } finally {
    client.release();
  }
});

const updateBody = createBody.partial().extend({
  replaceLines: z.boolean().optional(),
});

formulasRouter.patch("/v1/formulas/:id", requireAuth, requireWrite, async (req, res) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM formulas WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }

    const d = parsed.data;
    const nextTitle = d.title ?? String(existing.rows[0].title);
    const nextType = d.formulaType ?? String(existing.rows[0].formula_type);
    let nextLines = d.lines;
    if (!nextLines) {
      const currentLines = await client.query(
        `SELECT name, percent FROM formula_lines WHERE formula_id = $1`,
        [req.params.id],
      );
      nextLines = currentLines.rows.map((r) => ({
        source: "BD" as const,
        name: String(r.name),
        percent: Number(r.percent),
      }));
    }

    const issues = validateFormulaDraft({
      title: nextTitle,
      formulaType: nextType,
      lines: nextLines,
      requireLines: Boolean(d.replaceLines),
      requireCompletePercent: Boolean(d.replaceLines) && (nextLines?.length ?? 0) > 0,
    });
    if (issues.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "validation_failed", issues });
    }

    if (d.title) {
      const dup = await client.query(
        `SELECT id FROM formulas
         WHERE lab_id = $1 AND lower(title) = lower($2) AND id <> $3
         LIMIT 1`,
        [labId, d.title.trim(), req.params.id],
      );
      if (dup.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "title_duplicate",
          message: "Ya existe una fórmula con ese título en este laboratorio",
        });
      }
    }
    const updated = await client.query(
      `UPDATE formulas SET
        title = COALESCE($3, title),
        product_name = COALESCE($4, product_name),
        brand = COALESCE($5, brand),
        status = COALESCE($6, status),
        package_weight = COALESCE($7, package_weight),
        weight_unit = COALESCE($8, weight_unit),
        servings = COALESCE($9, servings),
        serving_size = COALESCE($10, serving_size),
        reconstituted_serving = COALESCE($11, reconstituted_serving),
        water_per_serving = COALESCE($12, water_per_serving),
        formula_type = COALESCE($13, formula_type),
        show_logo = COALESCE($14, show_logo),
        show_watermark = COALESCE($15, show_watermark),
        manufactured_by = COALESCE($16, manufactured_by),
        manufactured_for = COALESCE($17, manufactured_for),
        updated_at = now()
      WHERE id = $1 AND lab_id = $2
      RETURNING *`,
      [
        req.params.id,
        labId,
        d.title ?? null,
        d.productName ?? null,
        d.brand ?? null,
        d.status ?? null,
        d.packageWeight ?? null,
        d.weightUnit ?? null,
        d.servings ?? null,
        d.servingSize ?? null,
        d.reconstitutedServing ?? null,
        d.waterPerServing ?? null,
        d.formulaType ?? null,
        d.showLogo ?? null,
        d.showWatermark ?? null,
        d.manufacturedBy === undefined ? null : d.manufacturedBy,
        d.manufacturedFor === undefined ? null : d.manufacturedFor,
      ],
    );

    if (d.replaceLines && d.lines) {
      await client.query(`DELETE FROM formula_lines WHERE formula_id = $1`, [req.params.id]);
      for (let i = 0; i < d.lines.length; i++) {
        const line = d.lines[i];
        await client.query(
          `INSERT INTO formula_lines (
            formula_id, ingredient_id, source, external_ref, name, percent, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            req.params.id,
            line.ingredientId ?? null,
            line.source,
            line.externalRef ?? null,
            line.name,
            line.percent,
            line.sortOrder ?? i,
          ],
        );
      }
      await client.query(
        `UPDATE formulas SET ingredient_count = $2, updated_at = now() WHERE id = $1`,
        [req.params.id, d.lines.length],
      );
    }

    await client.query("COMMIT");

    const lines = await pool.query(
      `SELECT * FROM formula_lines WHERE formula_id = $1 ORDER BY sort_order ASC`,
      [req.params.id],
    );

    await writeAudit(req, {
      labId,
      action: "formula.update",
      detail: String(updated.rows[0].title),
    });

    return res.json({
      ...mapFormula(updated.rows[0]),
      lines: lines.rows.map(mapFormulaLine),
      labBranding: await loadLabBranding(labId, req),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_formula_failed", message });
  } finally {
    client.release();
  }
});

formulasRouter.delete("/v1/formulas/:id", requireAuth, requireWrite, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const result = await getPool().query(
      `DELETE FROM formulas WHERE id = $1 AND lab_id = $2 RETURNING id, title`,
      [req.params.id, labId],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    await writeAudit(req, {
      labId,
      action: "formula.delete",
      detail: String(result.rows[0].title),
    });
    return res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_formula_failed", message });
  }
});

/** Recalcula una fórmula guardada usando nutrientes de ingredients en BD. */
formulasRouter.post("/v1/formulas/:id/recalculate", requireAuth, requireWrite, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const formulaRes = await pool.query(
      `SELECT * FROM formulas WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!formulaRes.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    const formula = formulaRes.rows[0];

    const linesRes = await pool.query(
      `SELECT * FROM formula_lines WHERE formula_id = $1 ORDER BY sort_order ASC`,
      [req.params.id],
    );

    const issues = validateFormulaDraft({
      title: String(formula.title),
      formulaType: String(formula.formula_type),
      lines: linesRes.rows.map((r) => ({
        name: String(r.name),
        percent: Number(r.percent),
      })),
      requireLines: true,
      requireCompletePercent: true,
    });
    if (issues.length) {
      return res.status(400).json({ error: "validation_failed", issues });
    }

    const engineLines: Array<{
      source: IngredientSource;
      name: string;
      percent: number;
      per100g: ReturnType<typeof ingredientToPer100g>;
    }> = [];

    for (const line of linesRes.rows) {
      let per100g = ingredientToPer100g({});
      if (line.ingredient_id) {
        const ing = await pool.query(
          `SELECT * FROM ingredients WHERE id = $1 AND lab_id = $2`,
          [line.ingredient_id, labId],
        );
        if (ing.rows[0]) {
          per100g = ingredientToPer100g(ing.rows[0]);
        }
      }

      engineLines.push({
        source: line.source as IngredientSource,
        name: String(line.name),
        percent: Number(line.percent) || 0,
        per100g,
      });
    }

    const result = recalculateFormula({
      packageWeight: Number(formula.package_weight) || 100,
      reconstitutedServing: Number(formula.reconstituted_serving) || 0,
      formulaType: (formula.formula_type as FormulaType) || "Solido",
      lines: engineLines,
    });

    await writeAudit(req, {
      labId,
      action: "formula.recalculate",
      detail: String(formula.title),
    });

    return res.json({
      formulaId: formula.id,
      title: formula.title,
      productName: formula.product_name,
      brand: formula.brand,
      formulaType: formula.formula_type,
      packageWeight: Number(formula.package_weight),
      servings: Number(formula.servings),
      servingSize: Number(formula.serving_size),
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "recalculate_formula_failed", message });
  }
});
