import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { icbfRowToHit, icbfRowToSnapshot } from "../lib/catalog-profile.js";
import { upsertReadOnlyIngredient } from "../lib/ingredient-upsert.js";
import { resolveLabId } from "../lib/mappers.js";
import { fetchUsdaFood, searchUsdaFoods } from "../lib/usda.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";

export const catalogRouter = Router();

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

function httpError(error: unknown) {
  const err = error as { status?: number; code?: string; message?: string };
  return {
    status: err.status ?? 500,
    body: {
      error: err.code ?? "catalog_failed",
      message: err.message ?? String(error),
    },
  };
}

catalogRouter.get("/v1/catalog/icbf", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pool = getPool();
    const total = await pool.query(`SELECT count(*)::int AS n FROM icbf_foods`);
    const empty = (total.rows[0]?.n ?? 0) === 0;

    const result = q
      ? await pool.query(
          `SELECT * FROM icbf_foods
           WHERE nombre ILIKE $1 OR codigo ILIKE $1
           ORDER BY nombre ASC
           LIMIT 50`,
          [`%${q}%`],
        )
      : await pool.query(
          `SELECT * FROM icbf_foods ORDER BY nombre ASC LIMIT 40`,
        );

    return res.json({
      items: result.rows.map(icbfRowToHit),
      empty,
      hint: empty
        ? "Catálogo ICBF vacío. En nutri-api corre npm run db:seed-icbf (muestra) o npm run db:import-icbf si tienes MySQL/Excel."
        : null,
    });
  } catch (error) {
    const { status, body } = httpError(error);
    return res.status(status).json(body);
  }
});

catalogRouter.get("/v1/catalog/usda", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 3) {
      return res.json({ items: [], hint: "Escribe al menos 3 caracteres para buscar en USDA." });
    }
    const items = await searchUsdaFoods(q);
    return res.json({ items, empty: false, hint: null });
  } catch (error) {
    const { status, body } = httpError(error);
    return res.status(status).json(body);
  }
});

const attachBody = z.object({
  source: z.enum(["ICBF", "API"]),
  ref: z.string().min(1),
});

catalogRouter.post("/v1/catalog/attach", requireAuth, requireWrite, async (req, res) => {
  const parsed = attachBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

  try {
    const pool = getPool();
    const { source, ref } = parsed.data;

    if (source === "ICBF") {
      const found = await pool.query(`SELECT * FROM icbf_foods WHERE codigo = $1 LIMIT 1`, [ref]);
      if (!found.rows[0]) {
        return res.status(404).json({ error: "not_found", message: "Alimento ICBF no encontrado" });
      }
      const ingredient = await upsertReadOnlyIngredient(
        pool,
        labId,
        "ICBF",
        icbfRowToSnapshot(found.rows[0]),
      );
      await writeAudit(req, {
        labId,
        action: "catalog.attach",
        detail: `ICBF · ${ingredient.nombre} · ${ref}`,
      });
      return res.status(201).json(ingredient);
    }

    const snapshot = await fetchUsdaFood(ref);
    const ingredient = await upsertReadOnlyIngredient(pool, labId, "API", snapshot);
    await writeAudit(req, {
      labId,
      action: "catalog.attach",
      detail: `USDA · ${ingredient.nombre} · ${ref}`,
    });
    return res.status(201).json(ingredient);
  } catch (error) {
    const { status, body } = httpError(error);
    return res.status(status).json(body);
  }
});
