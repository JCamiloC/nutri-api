/**
 * Motor nutricional — portado desde Enerxis/cotizador/js/imprimirReceta.js
 *
 * Reglas clave del legacy:
 * - factor de línea = percent / 100
 * - macros: valor_per_100g_ingrediente * factor
 * - calorías calculadas: (grasa*9) + ((carb-fibra)*4) + (fibra*2) + (proteina*4)
 * - micros: array vitaminas [{ nombre, valor }] con nombres legacy (VitaminA, Iron, …)
 * - Solido/Liquido: per100 = totales; perServing = totales * (packageWeight/100)
 * - Reconstituida: per100 = totales * (ml100/100); perServing = totales * (reconstitutedServing/100)
 *   donde ml100 = reconstitutedServing * 100 / packageWeight
 */

export type IngredientSource = "ICBF" | "BD" | "API";
export type FormulaType = "Solido" | "Liquido" | "Reconstituida";

export interface NutrientDef {
  id: string;
  nombre: string;
  obligatorio: boolean;
  unidad?: string;
  indent?: 0 | 1 | 2;
  bold?: boolean;
  section: "macro" | "micro";
}

/** Orden Res. 810 / imprimirReceta MACROS */
export const MACROS: NutrientDef[] = [
  { id: "grasa", nombre: "Grasa total", obligatorio: true, section: "macro", unidad: "g" },
  { id: "grasaSaturada", nombre: "Grasa saturada", obligatorio: true, section: "macro", unidad: "g", indent: 1, bold: true },
  { id: "grasaMono", nombre: "Grasa monoinsaturada", obligatorio: false, section: "macro", unidad: "g", indent: 1 },
  { id: "grasaPoli", nombre: "Grasa poliinsaturada", obligatorio: false, section: "macro", unidad: "g", indent: 1 },
  { id: "grasaTrans", nombre: "Grasa trans", obligatorio: true, section: "macro", unidad: "mg", indent: 1, bold: true },
  { id: "colesterol", nombre: "Colesterol", obligatorio: false, section: "macro", unidad: "g" },
  { id: "carbohidratos", nombre: "Carbohidratos totales", obligatorio: true, section: "macro", unidad: "g" },
  { id: "fibra", nombre: "Fibra dietaria", obligatorio: true, section: "macro", unidad: "g", indent: 1 },
  { id: "fibraSol", nombre: "Fibra soluble", obligatorio: false, section: "macro", unidad: "g", indent: 2 },
  { id: "fibraInsol", nombre: "Fibra insoluble", obligatorio: false, section: "macro", unidad: "g", indent: 2 },
  { id: "polialcoholes", nombre: "Polialcoholes", obligatorio: false, section: "macro", unidad: "g", indent: 1 },
  { id: "azucar", nombre: "Azúcares totales", obligatorio: true, section: "macro", unidad: "g", indent: 1 },
  { id: "azucarAdd", nombre: "Azúcares añadidos", obligatorio: true, section: "macro", unidad: "g", indent: 2, bold: true },
  { id: "proteina", nombre: "Proteína", obligatorio: true, section: "macro", unidad: "g" },
  { id: "sodio", nombre: "Sodio", obligatorio: true, section: "macro", unidad: "mg", bold: true },
  { id: "potasio", nombre: "Potasio", obligatorio: false, section: "macro", unidad: "mg" },
];

/** Orden Res. 810 Art. 28.4: A → D → Hierro → Calcio → Zinc; resto Tabla 9 */
export const MICROS: NutrientDef[] = [
  { id: "vitaminaA", nombre: "Vitamina A", obligatorio: true, section: "micro", unidad: "μg ER" },
  { id: "vitaminaD", nombre: "Vitamina D", obligatorio: true, section: "micro", unidad: "μg" },
  { id: "hierro", nombre: "Hierro", obligatorio: true, section: "micro", unidad: "mg" },
  { id: "calcio", nombre: "Calcio", obligatorio: true, section: "micro", unidad: "mg" },
  { id: "zinc", nombre: "Zinc", obligatorio: true, section: "micro", unidad: "mg" },
  { id: "vitaminaE", nombre: "Vitamina E", obligatorio: false, section: "micro", unidad: "mg ET" },
  { id: "vitaminaK", nombre: "Vitamina K", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "vitaminaC", nombre: "Vitamina C", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "vitaminaB1", nombre: "Vitamina B1", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "vitaminaB2", nombre: "Vitamina B2", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "niacina", nombre: "Niacina", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "vitaminaB6", nombre: "Vitamina B6", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "acidoFolico", nombre: "Ácido fólico", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "vitaminaB12", nombre: "Vitamina B12", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "biotina", nombre: "Biotina", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "acidoPantotenico", nombre: "Ácido pantoténico", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "fosforo", nombre: "Fósforo", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "magnesio", nombre: "Magnesio", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "yodo", nombre: "Yodo", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "cobre", nombre: "Cobre", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "manganeso", nombre: "Manganeso", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "selenio", nombre: "Selenio", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "cromo", nombre: "Cromo", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "molibdeno", nombre: "Molibdeno", obligatorio: false, section: "micro", unidad: "μg" },
  { id: "cloro", nombre: "Cloro", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "fluor", nombre: "Flúor", obligatorio: false, section: "micro", unidad: "mg" },
  { id: "boro", nombre: "Boro", obligatorio: false, section: "micro", unidad: "mg" },
];

/** Nombres legacy en JSON vitaminas → id canónico del motor */
export const VITAMIN_NAME_ALIASES: Record<string, string> = {
  VitaminA: "vitaminaA",
  VitaminC: "vitaminaC",
  Calcium: "calcio",
  Iron: "hierro",
  VitaminD: "vitaminaD",
  VitaminE: "vitaminaE",
  VitaminB1: "vitaminaB1",
  VitaminB2: "vitaminaB2",
  Niacin: "niacina",
  VitaminB6: "vitaminaB6",
  FolicAcid: "acidoFolico",
  Folate: "acidoFolico",
  VitaminB12: "vitaminaB12",
  Phosphorus: "fosforo",
  Iodine: "yodo",
  Magnesium: "magnesio",
  Zinc: "zinc",
  Copper: "cobre",
  Manganese: "manganeso",
  Chromium: "cromo",
  Biotin: "biotina",
  Pantothenic: "acidoPantotenico",
  PantothenicAcid: "acidoPantotenico",
  VitaminK: "vitaminaK",
  Molybdenum: "molibdeno",
  Chlorine: "cloro",
  Chloride: "cloro",
  Selenium: "selenio",
  Fluor: "fluor",
  Fluoride: "fluor",
  Boron: "boro",
  // ids ya canónicos
  vitaminaA: "vitaminaA",
  vitaminaC: "vitaminaC",
  calcio: "calcio",
  hierro: "hierro",
  vitaminaD: "vitaminaD",
  vitaminaE: "vitaminaE",
  vitaminaB1: "vitaminaB1",
  vitaminaB2: "vitaminaB2",
  niacina: "niacina",
  vitaminaB6: "vitaminaB6",
  acidoFolico: "acidoFolico",
  vitaminaB12: "vitaminaB12",
  fosforo: "fosforo",
  yodo: "yodo",
  magnesio: "magnesio",
  zinc: "zinc",
  cobre: "cobre",
  manganeso: "manganeso",
  cromo: "cromo",
  biotina: "biotina",
  acidoPantotenico: "acidoPantotenico",
  vitaminaK: "vitaminaK",
  molibdeno: "molibdeno",
  cloro: "cloro",
  selenio: "selenio",
  fluor: "fluor",
  boro: "boro",
};

export type NutrientProfile = {
  /** Macros / micros numéricos por 100 g (campos Enerxis flexibles). */
  [key: string]: number | Array<{ nombre: string; valor: number }> | Record<string, unknown> | undefined;
  energiaKcal?: number;
  grasas?: number;
  grasa?: number;
  vitaminas?: Array<{ nombre: string; valor: number }>;
  alergenos?: Record<string, unknown>;
};

export interface FormulaLine {
  source: IngredientSource;
  name: string;
  percent: number;
  /** Nutrientes del ingrediente por 100 g (campos Enerxis: grasas, proteina, …). */
  per100g: NutrientProfile;
}

export interface RecalculateInput {
  lines: FormulaLine[];
  formulaType?: FormulaType;
  /** Enerxis `peso` — peso neto del paquete / base (g o mL). */
  packageWeight: number;
  /** Enerxis `porcionRec` — ml de porción reconstituida. */
  reconstitutedServing?: number;
}

export interface NutrientRowResult {
  id: string;
  label: string;
  per100: number;
  perServing: number;
  per100Label: string;
  perServingLabel: string;
  unit: string;
  obligatorio: boolean;
  indent?: 0 | 1 | 2;
  bold?: boolean;
  section: "macro" | "micro";
}

export interface RecalculateResult {
  percentTotal: number;
  percentComplete: boolean;
  caloriesPer100: number;
  caloriesPerServing: number;
  nutrients: NutrientRowResult[];
  legend: string;
  legendItems: string[];
  allergens: Record<string, unknown>;
  ingredientList: string;
}

const MACRO_FIELD_MAP: Record<string, string> = {
  grasa: "grasas",
  grasaSaturada: "grasaSaturada",
  grasaMono: "grasaMono",
  grasaPoli: "grasaPoli",
  grasaTrans: "grasaTrans",
  colesterol: "colesterol",
  carbohidratos: "carbohidratos",
  fibra: "fibra",
  fibraSol: "fibraSol",
  fibraInsol: "fibraInsol",
  polialcoholes: "polialcoholes",
  azucar: "azucar",
  azucarAdd: "azucarAdd",
  proteina: "proteina",
  sodio: "sodio",
  potasio: "potasio",
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanZero(str: string): string {
  const n = parseFloat(str);
  return n === 0 ? "0" : str.replace(/^-0(\.0+)?$/, "0");
}

/** formatValue de imprimirReceta (macros) */
export function formatMacroValue(value: number): string {
  const n = num(value);
  if (n === 0) return "0";
  if (n > 0 && n < 10) return cleanZero(n.toFixed(1));
  if (n >= 10) return cleanZero(n.toFixed(0));
  return cleanZero(String(n));
}

/** formatValueMicro de imprimirReceta */
export function formatMicroValue(value: number): string {
  const n = num(value);
  if (n === 0) return "0";
  if (n > 0 && n < 1) return cleanZero(n.toFixed(2));
  if (n > 1 && n < 10) return cleanZero(n.toFixed(1));
  if (n >= 10) return cleanZero(n.toFixed(0));
  return cleanZero(String(n));
}

/** Calorías Enerxis: grasa*9 + (carb-fibra)*4 + fibra*2 + proteina*4 */
export function computeCaloriesFromMacros(profile: {
  grasa: number;
  carbohidratos: number;
  fibra: number;
  proteina: number;
}): number {
  return (
    profile.grasa * 9 +
    (profile.carbohidratos - profile.fibra) * 4 +
    profile.fibra * 2 +
    profile.proteina * 4
  );
}

function readMacro(per100g: NutrientProfile, id: string): number {
  const key = MACRO_FIELD_MAP[id] ?? id;
  if (id === "grasa") {
    return num(per100g.grasas ?? per100g.grasa);
  }
  return num(per100g[key as keyof NutrientProfile] ?? per100g[id]);
}

function accumulateVitamins(
  totals: Record<string, number>,
  vitaminas: Array<{ nombre: string; valor: number }> | undefined,
  factor: number,
): void {
  if (!Array.isArray(vitaminas)) return;
  for (const vit of vitaminas) {
    const canonical = VITAMIN_NAME_ALIASES[vit.nombre] ?? vit.nombre;
    totals[canonical] = (totals[canonical] ?? 0) + num(vit.valor) * factor;
  }
  // También aceptar micros ya planos en per100g
}

function scaleFactors(input: RecalculateInput): { per100: number; perServing: number } {
  const type = input.formulaType ?? "Solido";
  const packageWeight = Math.max(0, num(input.packageWeight));
  const reconstituted = Math.max(0, num(input.reconstitutedServing));

  if (type === "Reconstituida") {
    const ml100 = packageWeight > 0 ? (reconstituted * 100) / packageWeight : 0;
    return {
      per100: ml100 / 100,
      perServing: reconstituted / 100,
    };
  }

  // Solido y Liquido (legacy)
  return {
    per100: 1,
    perServing: packageWeight / 100,
  };
}

function buildLegend(nutrients: NutrientRowResult[]): { legend: string; items: string[] } {
  const items: string[] = [];

  // Macros obligatorios (imprimirReceta) — ids canónicos del motor
  const mandatoryMacroIds = [
    "grasa",
    "grasaSaturada",
    "grasaTrans",
    "carbohidratos",
    "fibra",
    "azucar",
    "azucarAdd",
    "proteina",
    "sodio",
  ];

  for (const id of mandatoryMacroIds) {
    const row = nutrients.find((n) => n.id === id);
    if (row && num(row.per100) === 0) items.push(row.label);
  }

  // Macros opcionales “no aplica” frecuentes en etiquetas Enerxis
  for (const id of ["colesterol", "fibraSol", "fibraInsol", "polialcoholes", "potasio"]) {
    const row = nutrients.find((n) => n.id === id);
    if (row && num(row.per100) === 0) items.push(row.label);
  }

  // Micros en 0 → leyenda (misma lógica que el bloque vitaminaA/D/… del legacy)
  for (const micro of MICROS) {
    const row = nutrients.find((n) => n.id === micro.id);
    if (row && num(row.per100) === 0) items.push(row.label);
  }

  const legend =
    items.length === 0 ? "" : `No es fuente significativa de ${items.join(", ")}`;

  return { legend, items };
}

export function recalculateFormula(input: RecalculateInput): RecalculateResult {
  const macroTotals: Record<string, number> = {};
  const microTotals: Record<string, number> = {};
  for (const m of MACROS) macroTotals[m.id] = 0;
  for (const m of MICROS) microTotals[m.id] = 0;

  let caloriesBase = 0;
  let percentTotal = 0;
  const allergens: Record<string, unknown> = {};
  const ingredientAmounts: Array<{ name: string; amount: number }> = [];

  for (const line of input.lines) {
    const factor = num(line.percent) / 100;
    percentTotal += num(line.percent);

    for (const def of MACROS) {
      macroTotals[def.id] += readMacro(line.per100g, def.id) * factor;
    }

    caloriesBase +=
      computeCaloriesFromMacros({
        grasa: readMacro(line.per100g, "grasa"),
        carbohidratos: readMacro(line.per100g, "carbohidratos"),
        fibra: readMacro(line.per100g, "fibra"),
        proteina: readMacro(line.per100g, "proteina"),
      }) * factor;

    // micros planos + vitaminas[]
    for (const def of MICROS) {
      microTotals[def.id] += num(line.per100g[def.id]) * factor;
    }
    accumulateVitamins(microTotals, line.per100g.vitaminas, factor);

    if (line.per100g && typeof (line.per100g as { alergenos?: unknown }).alergenos === "object") {
      const raw = (line.per100g as { alergenos?: Record<string, unknown> }).alergenos ?? {};
      for (const [key, value] of Object.entries(raw)) {
        if (value && !(key in allergens)) allergens[key] = value;
      }
    }

    ingredientAmounts.push({ name: line.name, amount: factor });
  }

  const scales = scaleFactors(input);
  const caloriesPer100 = caloriesBase * scales.per100;
  const caloriesPerServing = caloriesBase * scales.perServing;

  const nutrients: NutrientRowResult[] = [
    ...MACROS.map((def) => {
      const base = macroTotals[def.id] ?? 0;
      const per100 = base * scales.per100;
      const perServing = base * scales.perServing;
      return {
        id: def.id,
        label: def.nombre,
        per100,
        perServing,
        per100Label: formatMacroValue(per100),
        perServingLabel: formatMacroValue(perServing),
        unit: def.unidad ?? "",
        obligatorio: def.obligatorio,
        indent: def.indent,
        bold: def.bold,
        section: def.section as "macro",
      };
    }),
    ...MICROS.map((def) => {
      const base = microTotals[def.id] ?? 0;
      const per100 = base * scales.per100;
      const perServing = base * scales.perServing;
      return {
        id: def.id,
        label: def.nombre,
        per100,
        perServing,
        per100Label: formatMicroValue(per100),
        perServingLabel: formatMicroValue(perServing),
        unit: def.unidad ?? "",
        obligatorio: def.obligatorio,
        indent: def.indent,
        bold: def.bold,
        section: def.section as "micro",
      };
    }),
  ];

  const { legend, items: legendItems } = buildLegend(nutrients);
  const ingredientList = ingredientAmounts
    .sort((a, b) => b.amount - a.amount)
    .map((i) => i.name)
    .join(", ");

  return {
    percentTotal,
    percentComplete: Math.abs(percentTotal - 100) < 0.01,
    caloriesPer100,
    caloriesPerServing,
    nutrients,
    legend,
    legendItems,
    allergens,
    ingredientList,
  };
}
