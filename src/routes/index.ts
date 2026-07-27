import { Router } from "express";
import { z } from "zod";
import { checkDatabase } from "../db/pool.js";
import { getPool } from "../db/pool.js";
import {
  recalculateFormula,
  type FormulaType,
  type IngredientSource,
} from "../nutrition-engine/index.js";

export const router = Router();

router.get("/health", async (_req, res) => {
  const db = await checkDatabase();
  let tables = 0;
  if (db.ok) {
    try {
      const result = await getPool().query(
        `SELECT count(*)::int AS n
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      tables = result.rows[0]?.n ?? 0;
    } catch {
      tables = -1;
    }
  }

  res.status(db.ok ? 200 : 503).json({
    service: "nutri-api",
    status: db.ok ? "ok" : "degraded",
    database: db,
    publicTables: tables,
    time: new Date().toISOString(),
  });
});

const nutrientProfile = z
  .object({
    grasas: z.number().optional(),
    grasa: z.number().optional(),
    grasaSaturada: z.number().optional(),
    grasaMono: z.number().optional(),
    grasaPoli: z.number().optional(),
    grasaTrans: z.number().optional(),
    colesterol: z.number().optional(),
    carbohidratos: z.number().optional(),
    fibra: z.number().optional(),
    fibraSol: z.number().optional(),
    fibraInsol: z.number().optional(),
    polialcoholes: z.number().optional(),
    azucar: z.number().optional(),
    azucarAdd: z.number().optional(),
    proteina: z.number().optional(),
    sodio: z.number().optional(),
    potasio: z.number().optional(),
    energiaKcal: z.number().optional(),
    vitaminas: z
      .array(z.object({ nombre: z.string(), valor: z.number() }))
      .optional(),
    alergenos: z.record(z.unknown()).optional(),
  })
  .passthrough();

const recalculateBody = z.object({
  packageWeight: z.number().positive(),
  reconstitutedServing: z.number().nonnegative().optional(),
  formulaType: z.enum(["Solido", "Liquido", "Reconstituida"]).optional(),
  lines: z
    .array(
      z.object({
        source: z.enum(["ICBF", "BD", "API"]),
        name: z.string().min(1),
        percent: z.number().min(0),
        per100g: nutrientProfile.default({}),
      }),
    )
    .min(1),
});

/** Recálculo puro (sin persistencia). Compatible con reglas Enerxis. */
router.post("/v1/recalculate", (req, res) => {
  const parsed = recalculateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const result = recalculateFormula({
    packageWeight: parsed.data.packageWeight,
    reconstitutedServing: parsed.data.reconstitutedServing,
    formulaType: parsed.data.formulaType as FormulaType | undefined,
    lines: parsed.data.lines.map((line) => ({
      ...line,
      source: line.source as IngredientSource,
      per100g: line.per100g,
    })),
  });

  return res.json(result);
});
