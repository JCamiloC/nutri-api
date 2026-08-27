/**
 * Sellos de advertencia frontal (Res. 810 / 2492 / 254)
 * Portado de cotizador/js/imprimirReceta.js
 */

export type WarningSealId =
  | "azucar"
  | "sodio"
  | "sat"
  | "trans"
  | "edulcorante";

export type WarningSeals = {
  azucar: boolean;
  sodio: boolean;
  sat: boolean;
  trans: boolean;
  edulcorante: boolean;
};

export type SealMetrics = {
  caloriesPer100: number;
  azucarAddPer100: number;
  sodioPer100: number;
  grasaSaturadaPer100: number;
  /** Trans en mg/100g (unidad del motor). */
  grasaTransPer100: number;
  porcAzucar: number;
  porcSodio: number;
  porcGrasaSat: number;
  porcGrasaTrans: number;
};

export const SEAL_LABELS: Record<WarningSealId, string> = {
  azucar: "EXCESO EN AZÚCARES",
  sodio: "EXCESO EN SODIO",
  sat: "EXCESO EN GRASAS SATURADAS",
  trans: "EXCESO EN GRASAS TRANS",
  edulcorante: "CONTIENE EDULCORANTES",
};

/**
 * Umbrales legacy:
 * - azúcares añadidos: % energía > 10
 * - sodio: mg/kcal > 1 Ó sodio > 300 mg/100g
 * - grasa sat: % energía > 10
 * - grasa trans: % energía > 1 (trans en g = mg/1000)
 * - edulcorante: solo flag manual
 */
export function computeWarningSeals(input: {
  caloriesPer100: number;
  azucarAddPer100: number;
  sodioPer100: number;
  grasaSaturadaPer100: number;
  grasaTransPer100: number;
  containsSweetener?: boolean;
}): { seals: WarningSeals; metrics: SealMetrics } {
  const cal = Number(input.caloriesPer100) || 0;
  const azucarAdd = Number(input.azucarAddPer100) || 0;
  const sodio = Number(input.sodioPer100) || 0;
  const sat = Number(input.grasaSaturadaPer100) || 0;
  const transMg = Number(input.grasaTransPer100) || 0;
  const transG = transMg / 1000;

  const porcAzucar = cal > 0 ? ((azucarAdd * 4) * 100) / cal : 0;
  const porcSodio = cal > 0 ? sodio / cal : 0;
  const porcGrasaSat = cal > 0 ? ((sat * 9) * 100) / cal : 0;
  const porcGrasaTrans = cal > 0 ? ((transG * 9) * 100) / cal : 0;

  return {
    seals: {
      azucar: porcAzucar > 10,
      sodio: porcSodio > 1 || sodio > 300,
      sat: porcGrasaSat > 10,
      trans: porcGrasaTrans > 1,
      edulcorante: Boolean(input.containsSweetener),
    },
    metrics: {
      caloriesPer100: cal,
      azucarAddPer100: azucarAdd,
      sodioPer100: sodio,
      grasaSaturadaPer100: sat,
      grasaTransPer100: transMg,
      porcAzucar,
      porcSodio,
      porcGrasaSat,
      porcGrasaTrans,
    },
  };
}

/** Aplica overrides manuales (checkbox) sobre el cálculo automático. */
export function applySealOverrides(
  computed: WarningSeals,
  overrides?: Partial<WarningSeals> | null,
): WarningSeals {
  if (!overrides) return computed;
  return {
    azucar: overrides.azucar ?? computed.azucar,
    sodio: overrides.sodio ?? computed.sodio,
    sat: overrides.sat ?? computed.sat,
    trans: overrides.trans ?? computed.trans,
    edulcorante: overrides.edulcorante ?? computed.edulcorante,
  };
}

export function nutrientPer100(
  nutrients: Array<{ id: string; per100: number }>,
  id: string,
): number {
  return Number(nutrients.find((n) => n.id === id)?.per100 ?? 0) || 0;
}
