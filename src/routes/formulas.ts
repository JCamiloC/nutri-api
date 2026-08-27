import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { validateFormulaDraft } from "../lib/formula-validation.js";
import {
  getLatestVersion,
  hashFormulaContent,
  insertFormulaVersion,
  mapFormulaVersion,
  type VersionSnapshot,
} from "../lib/formula-versions.js";
import { canResolveIngredientForFormula } from "../lib/ingredient-ownership.js";
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
import { applySealOverrides } from "../nutrition-engine/warning-seals.js";

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

const sealOverridesSchema = z
  .object({
    azucar: z.boolean().optional(),
    sodio: z.boolean().optional(),
    sat: z.boolean().optional(),
    trans: z.boolean().optional(),
    edulcorante: z.boolean().optional(),
  })
  .optional()
  .nullable();

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
  containsSweetener: z.boolean().optional(),
  rsa: z.string().optional().nullable(),
  flavor: z.string().optional().nullable(),
  usageMode: z.string().optional().nullable(),
  storageMode: z.string().optional().nullable(),
  manufacturedBy: z.string().optional().nullable(),
  manufacturedFor: z.string().optional().nullable(),
  sealOverrides: sealOverridesSchema,
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

  // Crear no gasta cupo (cotización libre). El cupo se cobra al imprimir.
  // No permitir marcar exportada en el alta.
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
        show_logo, show_watermark, sweetener, rsa, flavor, usage_mode, storage_mode,
        manufactured_by, manufactured_for, meta
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)
      RETURNING *`,
      [
        labId,
        data.title.trim(),
        data.productName ?? null,
        data.brand ?? null,
        data.status && data.status !== "exportada" ? data.status : "borrador",
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
        data.containsSweetener ? "1" : null,
        data.rsa?.trim() || null,
        data.flavor?.trim() || null,
        data.usageMode?.trim() || null,
        data.storageMode?.trim() || null,
        data.manufacturedBy ?? lab.manufactured_by_default ?? null,
        data.manufacturedFor ?? lab.manufactured_for_default ?? null,
        JSON.stringify(
          data.sealOverrides
            ? { sealOverrides: data.sealOverrides }
            : {},
        ),
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

    if (d.status === "exportada" && String(existing.rows[0].status) !== "exportada") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "use_print_endpoint",
        message:
          "El cupo se cobra al imprimir/exportar. Usa POST /v1/formulas/:id/print",
      });
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
    const existingMeta =
      existing.rows[0].meta && typeof existing.rows[0].meta === "object"
        ? (existing.rows[0].meta as Record<string, unknown>)
        : {};
    const nextMeta =
      d.sealOverrides !== undefined
        ? {
            ...existingMeta,
            sealOverrides: d.sealOverrides,
          }
        : existingMeta;

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
        sweetener = COALESCE($18, sweetener),
        rsa = COALESCE($19, rsa),
        flavor = COALESCE($20, flavor),
        usage_mode = COALESCE($21, usage_mode),
        storage_mode = COALESCE($22, storage_mode),
        meta = COALESCE($23::jsonb, meta),
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
        d.containsSweetener === undefined
          ? null
          : d.containsSweetener
            ? "1"
            : "",
        d.rsa === undefined ? null : d.rsa?.trim() || "",
        d.flavor === undefined ? null : d.flavor?.trim() || "",
        d.usageMode === undefined ? null : d.usageMode?.trim() || "",
        d.storageMode === undefined ? null : d.storageMode?.trim() || "",
        d.sealOverrides !== undefined ? JSON.stringify(nextMeta) : null,
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
        const ing = await pool.query(`SELECT * FROM ingredients WHERE id = $1`, [
          line.ingredient_id,
        ]);
        if (ing.rows[0] && canResolveIngredientForFormula(ing.rows[0], labId)) {
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

    const mapped = mapFormula(formula);
    const seals = applySealOverrides(
      {
        ...result.sealsSuggested,
        edulcorante:
          result.sealsSuggested.edulcorante || Boolean(mapped.containsSweetener),
      },
      mapped.sealOverrides,
    );

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
      rsa: mapped.rsa,
      flavor: mapped.flavor,
      usageMode: mapped.usageMode,
      storageMode: mapped.storageMode,
      containsSweetener: mapped.containsSweetener,
      seals,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "recalculate_formula_failed", message });
  }
});

/**
 * Emite el rotulado con versionado comercial:
 * - Contenido nuevo vs última versión → crea versión billable (1 cupo) + congela snapshot.
 * - Mismo contenido → reimpresión desde snapshot (sin cupo).
 */
formulasRouter.post("/v1/formulas/:id/print", requireAuth, requireWrite, async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const labId = getLabId(req, res);
    if (!labId) return;

    await client.query("BEGIN");

    const formulaRes = await client.query(
      `SELECT * FROM formulas WHERE id = $1 AND lab_id = $2 FOR UPDATE`,
      [req.params.id, labId],
    );
    if (!formulaRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    const formula = formulaRes.rows[0];

    const linesRes = await client.query(
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
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "validation_failed", issues });
    }

    const engineLines: Array<{
      source: IngredientSource;
      name: string;
      percent: number;
      per100g: ReturnType<typeof ingredientToPer100g>;
    }> = [];
    const snapshotLines: Array<Record<string, unknown>> = [];

    for (const line of linesRes.rows) {
      let per100g = ingredientToPer100g({});
      if (line.ingredient_id) {
        const ing = await client.query(`SELECT * FROM ingredients WHERE id = $1`, [
          line.ingredient_id,
        ]);
        if (ing.rows[0] && canResolveIngredientForFormula(ing.rows[0], labId)) {
          per100g = ingredientToPer100g(ing.rows[0]);
        }
      }
      engineLines.push({
        source: line.source as IngredientSource,
        name: String(line.name),
        percent: Number(line.percent) || 0,
        per100g,
      });
      snapshotLines.push({
        ingredientId: line.ingredient_id,
        source: line.source,
        name: line.name,
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

    const mappedFormula = mapFormula(formula);
    const seals = applySealOverrides(
      {
        ...result.sealsSuggested,
        edulcorante:
          result.sealsSuggested.edulcorante ||
          Boolean(mappedFormula.containsSweetener),
      },
      mappedFormula.sealOverrides,
    );

    const formulaPayload = {
      title: formula.title,
      productName: formula.product_name,
      brand: formula.brand,
      formulaType: formula.formula_type,
      packageWeight: Number(formula.package_weight),
      servings: Number(formula.servings),
      servingSize: Number(formula.serving_size),
      reconstitutedServing: Number(formula.reconstituted_serving) || 0,
      waterPerServing: Number(formula.water_per_serving) || 0,
      showLogo: formula.show_logo !== false,
      showWatermark: formula.show_watermark !== false,
      manufacturedBy: formula.manufactured_by,
      manufacturedFor: formula.manufactured_for,
      rsa: mappedFormula.rsa,
      flavor: mappedFormula.flavor,
      usageMode: mappedFormula.usageMode,
      storageMode: mappedFormula.storageMode,
      containsSweetener: mappedFormula.containsSweetener,
      seals,
    };

    const contentHash = hashFormulaContent({
      formula: formulaPayload,
      lines: snapshotLines,
      result: {
        calories: {
          per100: result.caloriesPer100,
          perServing: result.caloriesPerServing,
        },
        nutrients: result.nutrients,
        ingredientList: result.ingredientList,
        seals,
        allergens: result.allergens,
      },
    });

    const latest = await getLatestVersion(client, String(formula.id));
    const isReprint =
      latest != null && String(latest.content_hash) === contentHash;

    let versionRow = latest;
    let firstBillablePrint = false;
    let updated = formula;

    if (isReprint && latest) {
      // Reimpresión: entrega snapshot congelado (lo vendido), sin cupo.
      await client.query("COMMIT");
      const snap = (latest.snapshot ?? {}) as VersionSnapshot;
      const frozenResult = (snap.result ?? {}) as Record<string, unknown>;
      const capacity = await getLabCapacity(labId);
      await writeAudit(req, {
        labId,
        action: "formula.reprint",
        detail: `${String(formula.title)} · v${latest.version_label} (sin cupo)`,
      });
      return res.json({
        formulaId: formula.id,
        title: snap.formula?.title ?? formula.title,
        productName: snap.formula?.productName ?? formula.product_name,
        brand: snap.formula?.brand ?? formula.brand,
        formulaType: snap.formula?.formulaType ?? formula.formula_type,
        packageWeight: Number(snap.formula?.packageWeight ?? formula.package_weight),
        servings: Number(snap.formula?.servings ?? formula.servings),
        servingSize: Number(snap.formula?.servingSize ?? formula.serving_size),
        status: formula.status,
        billed: false,
        firstBillablePrint: false,
        isReprint: true,
        version: mapFormulaVersion(latest),
        capacity,
        formula: {
          ...mapFormula(formula),
          lines: linesRes.rows.map(mapFormulaLine),
          labBranding: await loadLabBranding(labId, req),
        },
        percentTotal: frozenResult.percentTotal ?? result.percentTotal,
        percentComplete: frozenResult.percentComplete ?? result.percentComplete,
        caloriesPer100: frozenResult.caloriesPer100 ?? result.caloriesPer100,
        caloriesPerServing: frozenResult.caloriesPerServing ?? result.caloriesPerServing,
        legend: frozenResult.legend ?? result.legend,
        ingredientList: frozenResult.ingredientList ?? result.ingredientList,
        nutrients: frozenResult.nutrients ?? result.nutrients,
        seals: frozenResult.seals ?? seals,
        allergens: frozenResult.allergens ?? result.allergens,
      });
    }

    const capacityBefore = await getLabCapacity(labId);
    if (!capacityBefore || capacityBefore.remaining <= 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "quota_exceeded",
        message: `Cupo de emisiones agotado (${capacityBefore?.used ?? 0}/${capacityBefore?.total ?? 0} versiones). Solicita un pack extra o un plan superior. Cotizar/recalcular no gasta cupo; solo una versión nueva.`,
        capacity: capacityBefore,
      });
    }

    const snapshot: VersionSnapshot = {
      formula: formulaPayload,
      lines: snapshotLines,
      result: {
        percentTotal: result.percentTotal,
        percentComplete: result.percentComplete,
        caloriesPer100: result.caloriesPer100,
        caloriesPerServing: result.caloriesPerServing,
        legend: result.legend,
        ingredientList: result.ingredientList,
        nutrients: result.nutrients,
        allergens: result.allergens,
        seals,
        sealMetrics: result.sealMetrics,
      },
      printedAt: new Date().toISOString(),
      printedBy: req.user?.email ?? req.user?.name ?? null,
    };

    try {
      versionRow = await insertFormulaVersion(client, {
        formulaId: String(formula.id),
        labId,
        contentHash,
        snapshot,
        createdByUserId: req.user?.id ?? null,
        billable: true,
      });
    } catch (insertErr) {
      const pgErr = insertErr as { code?: string };
      // Carrera: otra emisión ya creó la misma versión
      if (pgErr.code === "23505") {
        const existing = await client.query(
          `SELECT * FROM formula_versions WHERE formula_id = $1 AND content_hash = $2`,
          [formula.id, contentHash],
        );
        if (existing.rows[0]) {
          versionRow = existing.rows[0];
          await client.query("COMMIT");
          const capacity = await getLabCapacity(labId);
          return res.json({
            formulaId: formula.id,
            title: formula.title,
            productName: formula.product_name,
            brand: formula.brand,
            formulaType: formula.formula_type,
            packageWeight: Number(formula.package_weight),
            servings: Number(formula.servings),
            servingSize: Number(formula.serving_size),
            status: formula.status,
            billed: false,
            firstBillablePrint: false,
            isReprint: true,
            version: mapFormulaVersion(versionRow),
            capacity,
            formula: {
              ...mapFormula(formula),
              lines: linesRes.rows.map(mapFormulaLine),
              labBranding: await loadLabBranding(labId, req),
            },
            ...result,
          });
        }
      }
      throw insertErr;
    }

    firstBillablePrint = true;
    const up = await client.query(
      `UPDATE formulas SET status = 'exportada', updated_at = now()
       WHERE id = $1 AND lab_id = $2
       RETURNING *`,
      [req.params.id, labId],
    );
    updated = up.rows[0] ?? formula;

    await client.query("COMMIT");

    const capacity = await getLabCapacity(labId);
    await writeAudit(req, {
      labId,
      action: "formula.print",
      detail: `${String(updated.title)} · v${versionRow.version_label} (1 cupo)`,
    });

    return res.json({
      formulaId: updated.id,
      title: updated.title,
      productName: updated.product_name,
      brand: updated.brand,
      formulaType: updated.formula_type,
      packageWeight: Number(updated.package_weight),
      servings: Number(updated.servings),
      servingSize: Number(updated.serving_size),
      status: updated.status,
      billed: true,
      firstBillablePrint,
      isReprint: false,
      version: mapFormulaVersion(versionRow),
      capacity,
      formula: {
        ...mapFormula(updated),
        lines: linesRes.rows.map(mapFormulaLine),
        labBranding: await loadLabBranding(labId, req),
      },
      seals,
      ...result,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "print_formula_failed", message });
  } finally {
    client.release();
  }
});

/** Historial de versiones emitidas (inmutables). */
formulasRouter.get("/v1/formulas/:id/versions", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const formula = await pool.query(
      `SELECT id FROM formulas WHERE id = $1 AND lab_id = $2`,
      [req.params.id, labId],
    );
    if (!formula.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    const versions = await pool.query(
      `SELECT id, formula_id, lab_id, version_label, version_seq, billable,
              content_hash, created_by_user_id, created_at
       FROM formula_versions
       WHERE formula_id = $1
       ORDER BY version_seq DESC`,
      [req.params.id],
    );
    return res.json({
      items: versions.rows.map((row) => ({
        ...mapFormulaVersion(row),
        snapshot: undefined,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_versions_failed", message });
  }
});

/** Detalle de una versión (snapshot congelado). */
formulasRouter.get(
  "/v1/formulas/:id/versions/:versionId",
  requireAuth,
  async (req, res) => {
    try {
      const labId = getLabId(req, res);
      if (!labId) return;
      const pool = getPool();
      const formula = await pool.query(
        `SELECT id FROM formulas WHERE id = $1 AND lab_id = $2`,
        [req.params.id, labId],
      );
      if (!formula.rows[0]) {
        return res.status(404).json({ error: "not_found" });
      }
      const version = await pool.query(
        `SELECT * FROM formula_versions
         WHERE id = $1 AND formula_id = $2 AND lab_id = $3`,
        [req.params.versionId, req.params.id, labId],
      );
      if (!version.rows[0]) {
        return res.status(404).json({ error: "version_not_found" });
      }
      return res.json(mapFormulaVersion(version.rows[0]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "get_version_failed", message });
    }
  },
);
