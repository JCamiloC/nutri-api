import type { NutrientProfile } from "../nutrition-engine/index.js";

/** Mapea fila de ingredients (snake o camel del mapper) a perfil per 100 g del motor. */
export function ingredientToPer100g(ing: Record<string, unknown>): NutrientProfile {
  const vitaminasRaw = ing.vitaminas;
  let vitaminas: Array<{ nombre: string; valor: number }> = [];
  if (Array.isArray(vitaminasRaw)) {
    vitaminas = vitaminasRaw
      .map((v) => {
        if (!v || typeof v !== "object") return null;
        const row = v as Record<string, unknown>;
        return {
          nombre: String(row.nombre ?? ""),
          valor: Number(row.valor) || 0,
        };
      })
      .filter((v): v is { nombre: string; valor: number } => Boolean(v?.nombre));
  }

  return {
    grasas: Number(ing.grasas) || 0,
    grasaSaturada: Number(ing.grasa_saturada ?? ing.grasaSaturada) || 0,
    grasaMono: Number(ing.grasa_mono ?? ing.grasaMono) || 0,
    grasaPoli: Number(ing.grasa_poli ?? ing.grasaPoli) || 0,
    grasaTrans: Number(ing.grasa_trans ?? ing.grasaTrans) || 0,
    colesterol: Number(ing.colesterol) || 0,
    sodio: Number(ing.sodio) || 0,
    potasio: Number(ing.potasio) || 0,
    carbohidratos: Number(ing.carbohidratos) || 0,
    fibra: Number(ing.fibra) || 0,
    fibraSol: Number(ing.fibra_sol ?? ing.fibraSol) || 0,
    fibraInsol: Number(ing.fibra_insol ?? ing.fibraInsol) || 0,
    polialcoholes: Number(ing.polialcoholes) || 0,
    azucar: Number(ing.azucar) || 0,
    azucarAdd: Number(ing.azucar_add ?? ing.azucarAdd) || 0,
    proteina: Number(ing.proteina) || 0,
    energiaKcal: Number(ing.energia_kcal ?? ing.energiaKcal) || 0,
    vitaminas,
    alergenos:
      ing.alergenos && typeof ing.alergenos === "object"
        ? (ing.alergenos as Record<string, unknown>)
        : {},
  };
}
