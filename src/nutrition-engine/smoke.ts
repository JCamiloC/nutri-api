import { recalculateFormula } from "./index.js";

/** Smoke test sin base de datos — valida reglas portadas de imprimirReceta. */
const result = recalculateFormula({
  formulaType: "Solido",
  packageWeight: 30,
  lines: [
    {
      source: "BD",
      name: "Concentrado proteico",
      percent: 60,
      per100g: {
        grasas: 5,
        grasaSaturada: 2,
        carbohidratos: 10,
        fibra: 1,
        proteina: 80,
        sodio: 200,
        azucar: 2,
        azucarAdd: 2,
        vitaminas: [
          { nombre: "Iron", valor: 4 },
          { nombre: "Calcium", valor: 100 },
          { nombre: "Zinc", valor: 2 },
        ],
      },
    },
    {
      source: "ICBF",
      name: "Azúcar blanca",
      percent: 40,
      per100g: {
        grasas: 0,
        carbohidratos: 100,
        fibra: 0,
        proteina: 0,
        sodio: 0,
        azucar: 100,
        azucarAdd: 100,
      },
    },
  ],
});

const pick = (id: string) => result.nutrients.find((n) => n.id === id);

console.log(
  JSON.stringify(
    {
      percentTotal: result.percentTotal,
      percentComplete: result.percentComplete,
      caloriesPer100: Math.round(result.caloriesPer100 * 100) / 100,
      caloriesPerServing: Math.round(result.caloriesPerServing * 100) / 100,
      ingredientList: result.ingredientList,
      legend: result.legend,
      sample: {
        proteina: pick("proteina"),
        carbohidratos: pick("carbohidratos"),
        azucar: pick("azucar"),
        hierro: pick("hierro"),
        calcio: pick("calcio"),
      },
    },
    null,
    2,
  ),
);
