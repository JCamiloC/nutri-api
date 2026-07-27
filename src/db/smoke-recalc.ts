import "dotenv/config";
import { DEMO_LAB_ID } from "../config/constants.js";
import { ingredientToPer100g } from "../lib/ingredient-profile.js";
import { recalculateFormula } from "../nutrition-engine/index.js";
import { getPool } from "./pool.js";

async function main() {
  const pool = getPool();
  const f = await pool.query(
    `SELECT id FROM formulas WHERE lab_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [DEMO_LAB_ID],
  );
  if (!f.rows[0]) throw new Error("no formula");
  const id = f.rows[0].id as string;
  const lines = await pool.query(`SELECT * FROM formula_lines WHERE formula_id=$1`, [id]);
  const formula = (await pool.query(`SELECT * FROM formulas WHERE id=$1`, [id])).rows[0];

  const engineLines = [];
  for (const line of lines.rows) {
    let per100g = ingredientToPer100g({});
    if (line.ingredient_id) {
      const ing = await pool.query(`SELECT * FROM ingredients WHERE id=$1`, [line.ingredient_id]);
      if (ing.rows[0]) per100g = ingredientToPer100g(ing.rows[0]);
    }
    engineLines.push({
      source: line.source,
      name: line.name,
      percent: Number(line.percent),
      per100g,
    });
  }

  const result = recalculateFormula({
    packageWeight: Number(formula.package_weight),
    formulaType: formula.formula_type,
    lines: engineLines,
  });

  console.log(
    JSON.stringify(
      {
        id,
        lines: engineLines.length,
        percentTotal: result.percentTotal,
        caloriesPer100: Math.round(result.caloriesPer100),
        caloriesPerServing: Math.round(result.caloriesPerServing),
        nutrientsShown: result.nutrients.filter(
          (n) => n.obligatorio || Math.abs(n.per100) > 0,
        ).length,
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
