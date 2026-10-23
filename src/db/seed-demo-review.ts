/**
 * Fórmula demo local para revisar tablas, sellos, logo y nutrientes visibles.
 * npm run db:seed-demo-review
 */
import fs from "node:fs";
import "dotenv/config";
import { DEMO_LAB_ID } from "../config/constants.js";
import { ensureLabLogoPrintPng } from "../lib/lab-logo-print.js";
import { ensureLabLogoDir, labLogoPath } from "../lib/uploads.js";
import { MACROS, MICROS } from "../nutrition-engine/index.js";
import { getPool } from "./pool.js";

const DEMO_TITLE = "DEMO QA Rotulado completo";

const DEMO_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" role="img" aria-label="Andes Lab demo">
  <rect width="320" height="80" rx="12" fill="#166e87"/>
  <text x="24" y="52" fill="#ffffff" font-family="Arial,sans-serif" font-size="28" font-weight="700">Andes Lab</text>
  <text x="200" y="52" fill="#a8e4f0" font-family="Arial,sans-serif" font-size="18" font-weight="600">NutriLab QA</text>
</svg>`;

function allNutrientTogglesOn(): Record<string, boolean> {
  const ids = [...MACROS, ...MICROS].map((n) => n.id);
  return Object.fromEntries(ids.map((id) => [id, true]));
}

const VITAMIN_PREMIX = [
  { nombre: "VitaminA", valor: 800 },
  { nombre: "VitaminD", valor: 15 },
  { nombre: "VitaminE", valor: 12 },
  { nombre: "VitaminK", valor: 45 },
  { nombre: "VitaminC", valor: 90 },
  { nombre: "VitaminB1", valor: 1.2 },
  { nombre: "VitaminB2", valor: 1.4 },
  { nombre: "Niacin", valor: 16 },
  { nombre: "VitaminB6", valor: 1.8 },
  { nombre: "FolicAcid", valor: 400 },
  { nombre: "VitaminB12", valor: 2.4 },
  { nombre: "Biotin", valor: 30 },
  { nombre: "PantothenicAcid", valor: 5 },
  { nombre: "Calcium", valor: 1200 },
  { nombre: "Iron", valor: 14 },
  { nombre: "Zinc", valor: 11 },
  { nombre: "Phosphorus", valor: 700 },
  { nombre: "Magnesium", valor: 320 },
  { nombre: "Iodine", valor: 150 },
  { nombre: "Copper", valor: 0.9 },
  { nombre: "Manganese", valor: 2.3 },
  { nombre: "Selenium", valor: 55 },
  { nombre: "Chromium", valor: 35 },
  { nombre: "Molybdenum", valor: 45 },
];

async function upsertIngredient(
  pool: ReturnType<typeof getPool>,
  row: {
    referencia: string;
    nombre: string;
    proteina: number;
    grasas: number;
    grasa_saturada: number;
    grasa_mono: number;
    grasa_poli: number;
    grasa_trans: number;
    carbohidratos: number;
    fibra: number;
    fibra_sol: number;
    fibra_insol: number;
    azucar: number;
    azucar_add: number;
    sodio: number;
    potasio: number;
    colesterol: number;
    polialcoholes: number;
    energia_kcal: number;
    vitaminas?: Array<{ nombre: string; valor: number }>;
  },
) {
  const existing = await pool.query(
    `SELECT id FROM ingredients WHERE lab_id = $1 AND source = 'BD' AND referencia = $2 LIMIT 1`,
    [DEMO_LAB_ID, row.referencia],
  );
  const vitaminas = JSON.stringify(row.vitaminas ?? []);
  if (existing.rows[0]) {
    const id = existing.rows[0].id as string;
    await pool.query(
      `UPDATE ingredients SET
        nombre = $2, proteina = $3, grasas = $4, grasa_saturada = $5, grasa_mono = $6, grasa_poli = $7,
        grasa_trans = $8, carbohidratos = $9, fibra = $10, fibra_sol = $11, fibra_insol = $12,
        azucar = $13, azucar_add = $14, sodio = $15, potasio = $16, colesterol = $17,
        polialcoholes = $18, energia_kcal = $19, vitaminas = $20::jsonb, updated_at = now()
       WHERE id = $1`,
      [
        id,
        row.nombre,
        row.proteina,
        row.grasas,
        row.grasa_saturada,
        row.grasa_mono,
        row.grasa_poli,
        row.grasa_trans,
        row.carbohidratos,
        row.fibra,
        row.fibra_sol,
        row.fibra_insol,
        row.azucar,
        row.azucar_add,
        row.sodio,
        row.potasio,
        row.colesterol,
        row.polialcoholes,
        row.energia_kcal,
        vitaminas,
      ],
    );
    return id;
  }
  const ins = await pool.query(
    `INSERT INTO ingredients (
      lab_id, source, referencia, nombre, read_only, is_base,
      tipo, estado, unidad_medida, costo,
      grasas, grasa_saturada, grasa_mono, grasa_poli, grasa_trans,
      colesterol, sodio, potasio, carbohidratos, fibra, fibra_sol, fibra_insol,
      polialcoholes, azucar, azucar_add, proteina, energia_kcal, vitaminas,
      contains_sweetener, is_additive
    ) VALUES (
      $1, 'BD', $2, $3, false, false,
      'MATERIA PRIMA', 'POLVO', 'g', 0,
      $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21::jsonb,
      false, false
    ) RETURNING id`,
    [
      DEMO_LAB_ID,
      row.referencia,
      row.nombre,
      row.grasas,
      row.grasa_saturada,
      row.grasa_mono,
      row.grasa_poli,
      row.grasa_trans,
      row.colesterol,
      row.sodio,
      row.potasio,
      row.carbohidratos,
      row.fibra,
      row.fibra_sol,
      row.fibra_insol,
      row.polialcoholes,
      row.azucar,
      row.azucar_add,
      row.proteina,
      row.energia_kcal,
      vitaminas,
    ],
  );
  return ins.rows[0].id as string;
}

async function main() {
  const pool = getPool();

  ensureLabLogoDir(DEMO_LAB_ID);
  fs.writeFileSync(labLogoPath(DEMO_LAB_ID, "svg"), DEMO_LOGO_SVG, "utf8");
  await ensureLabLogoPrintPng(DEMO_LAB_ID, "svg");
  await pool.query(
    `UPDATE labs SET
      logo_ext = 'svg',
      watermark_default = true,
      manufactured_by_default = 'Andes Lab Nutrición S.A.S. · Bogotá',
      manufactured_for_default = 'Distribuidora Enerxis Demo',
      usage_mode_default = 'Consumir una barra al día como snack.',
      updated_at = now()
     WHERE id = $1`,
    [DEMO_LAB_ID],
  );

  const ingWhey = await upsertIngredient(pool, {
    referencia: "DEMO-WHEY",
    nombre: "Proteína whey concentrada",
    proteina: 72,
    grasas: 8,
    grasa_saturada: 4.5,
    grasa_mono: 2,
    grasa_poli: 1,
    grasa_trans: 0,
    carbohidratos: 12,
    fibra: 0,
    fibra_sol: 0,
    fibra_insol: 0,
    azucar: 6,
    azucar_add: 0,
    sodio: 180,
    potasio: 420,
    colesterol: 45,
    polialcoholes: 0,
    energia_kcal: 390,
    vitaminas: [{ nombre: "Calcium", valor: 120 }],
  });

  const ingAvena = await upsertIngredient(pool, {
    referencia: "DEMO-OAT",
    nombre: "Avena laminada micronizada",
    proteina: 14,
    grasas: 7,
    grasa_saturada: 1.2,
    grasa_mono: 2.5,
    grasa_poli: 2.8,
    grasa_trans: 0,
    carbohidratos: 66,
    fibra: 10,
    fibra_sol: 4,
    fibra_insol: 6,
    azucar: 1,
    azucar_add: 0,
    sodio: 4,
    potasio: 390,
    colesterol: 0,
    polialcoholes: 0,
    energia_kcal: 380,
  });

  const ingCacao = await upsertIngredient(pool, {
    referencia: "DEMO-CACAO",
    nombre: "Manteca de cacao",
    proteina: 2,
    grasas: 62,
    grasa_saturada: 38,
    grasa_mono: 18,
    grasa_poli: 2,
    grasa_trans: 0.2,
    carbohidratos: 18,
    fibra: 14,
    fibra_sol: 0,
    fibra_insol: 14,
    azucar: 2,
    azucar_add: 0,
    sodio: 12,
    potasio: 650,
    colesterol: 0,
    polialcoholes: 0,
    energia_kcal: 580,
  });

  const ingPremix = await upsertIngredient(pool, {
    referencia: "DEMO-PREMIX",
    nombre: "Premix vitamínico-mineral Enerxis",
    proteina: 0,
    grasas: 0,
    grasa_saturada: 0,
    grasa_mono: 0,
    grasa_poli: 0,
    grasa_trans: 0,
    carbohidratos: 95,
    fibra: 0,
    fibra_sol: 0,
    fibra_insol: 0,
    azucar: 0,
    azucar_add: 0,
    sodio: 50,
    potasio: 0,
    colesterol: 0,
    polialcoholes: 0,
    energia_kcal: 200,
    vitaminas: VITAMIN_PREMIX,
  });

  await pool.query(`DELETE FROM formulas WHERE lab_id = $1 AND title = $2`, [
    DEMO_LAB_ID,
    DEMO_TITLE,
  ]);

  const meta = {
    tableFormats: { estandar: true, simplificada: true, lineal: true, tabular: true },
    nutrientToggles: allNutrientTogglesOn(),
    sealOverrides: { azucar: true, sodio: true, sat: true, trans: false, edulcorante: false },
    ingredientListText:
      "Proteína whey concentrada, avena laminada micronizada, manteca de cacao, premix vitamínico-mineral Enerxis.",
    allergenListText: "Puede contener trazas de leche, soya y frutos secos.",
    hasSecondaryPackaging: false,
  };

  const formula = await pool.query(
    `INSERT INTO formulas (
      lab_id, title, product_name, brand, status,
      package_weight, weight_unit, servings, serving_size, formula_type, ingredient_count,
      show_logo, show_watermark, rsa, flavor, usage_mode, storage_mode, sweetener,
      manufactured_by, manufactured_for, meta
    ) VALUES (
      $1, $2, $3, $4, 'lista',
      45, 'g', 1, 45, 'Solido', 4,
      true, true, 'RSA-DEMO-2026-001', 'Chocolate avellana', $5, $6, false,
      $7, $8, $9::jsonb
    ) RETURNING id`,
    [
      DEMO_LAB_ID,
      DEMO_TITLE,
      "Barra Enerxis Multinutriente",
      "Andes Lab",
      "Consumir una barra al día como snack.",
      "Conservar en lugar fresco y seco, alejado de la luz solar.",
      "Andes Lab Nutrición S.A.S. · Bogotá",
      "Distribuidora Enerxis Demo",
      JSON.stringify(meta),
    ],
  );

  const formulaId = formula.rows[0].id as string;

  const lines: Array<[string, string, number]> = [
    [ingWhey, "Proteína whey concentrada", 38.5],
    [ingAvena, "Avena laminada micronizada", 34.25],
    [ingCacao, "Manteca de cacao", 22.25],
    [ingPremix, "Premix vitamínico-mineral Enerxis", 5],
  ];

  for (let i = 0; i < lines.length; i++) {
    const [ingredientId, name, percent] = lines[i];
    await pool.query(
      `INSERT INTO formula_lines (formula_id, ingredient_id, source, name, percent, sort_order)
       VALUES ($1, $2, 'BD', $3, $4, $5)`,
      [formulaId, ingredientId, name, percent, i],
    );
  }

  console.log("[seed-demo-review] Laboratorio:", DEMO_LAB_ID);
  console.log("[seed-demo-review] Logo: http://localhost:4000/uploads/labs/" + DEMO_LAB_ID + "/logo.svg");
  console.log("[seed-demo-review] Fórmula id:", formulaId);
  console.log(
    "[seed-demo-review] Editor:",
    `http://localhost:3002/app/tablas/editor?id=${formulaId}`,
  );
  console.log("[seed-demo-review] Login: admin@andeslab.co / demo1234");
  console.log("[seed-demo-review] Abre el editor → Guardar y recalcular si la vista previa no carga sola.");

  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed-demo-review] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
