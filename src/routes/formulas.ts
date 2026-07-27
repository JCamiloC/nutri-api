import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { mapFormula, mapFormulaLine, resolveLabId } from "../lib/mappers.js";

export const formulasRouter = Router();

formulasRouter.get("/v1/formulas", async (req, res) => {
  try {
    const labId = resolveLabId(req);
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

formulasRouter.get("/v1/formulas/:id", async (req, res) => {
  try {
    const labId = resolveLabId(req);
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

formulasRouter.post("/v1/formulas", async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = resolveLabId(req);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const data = parsed.data;
    const lines = data.lines ?? [];
    const insert = await client.query(
      `INSERT INTO formulas (
        lab_id, title, product_name, brand, status,
        package_weight, weight_unit, servings, serving_size,
        reconstituted_serving, water_per_serving, formula_type, ingredient_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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

    return res.status(201).json({
      ...mapFormula(formula),
      lines: savedLines.rows.map(mapFormulaLine),
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

formulasRouter.patch("/v1/formulas/:id", async (req, res) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = resolveLabId(req);
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

    return res.json({
      ...mapFormula(updated.rows[0]),
      lines: lines.rows.map(mapFormulaLine),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_formula_failed", message });
  } finally {
    client.release();
  }
});

formulasRouter.delete("/v1/formulas/:id", async (req, res) => {
  try {
    const labId = resolveLabId(req);
    const result = await getPool().query(
      `DELETE FROM formulas WHERE id = $1 AND lab_id = $2 RETURNING id`,
      [req.params.id, labId],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_formula_failed", message });
  }
});
