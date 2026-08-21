import { env } from "../config/env.js";
import { num, type CatalogHit, type NutrientSnapshot } from "./catalog-profile.js";

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const SEARCH_TTL_MS = 2 * 60 * 1000;

const searchCache = new Map<string, { at: number; items: CatalogHit[] }>();

const VITAMIN_MAP: Array<{ numbers: string[]; names: string[]; label: string }> = [
  { numbers: ["320", "318"], names: ["Vitamin A, RAE", "Vitamin A, IU"], label: "Vitamina A" },
  { numbers: ["401"], names: ["Vitamin C, total ascorbic acid"], label: "Vitamina C" },
  { numbers: ["328", "324"], names: ["Vitamin D (D2 + D3)", "Vitamin D"], label: "Vitamina D" },
  { numbers: ["323"], names: ["Vitamin E (alpha-tocopherol)"], label: "Vitamina E" },
  { numbers: ["404"], names: ["Thiamin"], label: "Vitamina B1" },
  { numbers: ["405"], names: ["Riboflavin"], label: "Vitamina B2" },
  { numbers: ["406"], names: ["Niacin"], label: "Niacina" },
  { numbers: ["415"], names: ["Vitamin B-6"], label: "Vitamina B6" },
  { numbers: ["417"], names: ["Folate, total"], label: "Ácido fólico" },
  { numbers: ["418"], names: ["Vitamin B-12"], label: "Vitamina B12" },
  { numbers: ["301"], names: ["Calcium, Ca"], label: "Calcio" },
  { numbers: ["303"], names: ["Iron, Fe"], label: "Hierro" },
  { numbers: ["305"], names: ["Phosphorus, P"], label: "Fósforo" },
  { numbers: ["304"], names: ["Magnesium, Mg"], label: "Magnesio" },
  { numbers: ["309"], names: ["Zinc, Zn"], label: "Zinc" },
];

type NutrientPick = { amount: number; unit: string; number: string; name: string };

function requireUsdaKey(): string {
  return env.usdaApiKey.trim() || "DEMO_KEY";
}

function nutrientList(data: Record<string, unknown>): NutrientPick[] {
  const raw = data.foodNutrients;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const nested = (row.nutrient ?? {}) as Record<string, unknown>;
    return {
      amount: num(row.amount ?? row.value),
      unit: String(row.unitName ?? nested.unitName ?? "").toUpperCase(),
      number: String(row.nutrientNumber ?? nested.number ?? nested.id ?? ""),
      name: String(row.nutrientName ?? nested.name ?? ""),
    };
  });
}

function pick(nutrients: NutrientPick[], numbers: string[], names: string[]): number {
  const byNumber = nutrients.find((n) => numbers.includes(n.number));
  if (byNumber) return byNumber.amount;
  const byName = nutrients.find((n) => names.includes(n.name));
  return byName ? byName.amount : 0;
}

function pickEnergyKcal(nutrients: NutrientPick[]): number {
  const kcal = nutrients.find(
    (n) =>
      n.number === "208" ||
      ((n.name === "Energy" || n.name.startsWith("Energy")) && n.unit.includes("KCAL")),
  );
  if (kcal) return kcal.amount;
  const kj = nutrients.find((n) => n.number === "268" || (n.name === "Energy" && n.unit.includes("KJ")));
  if (kj) return kj.amount / 4.184;
  return pick(nutrients, ["208"], ["Energy"]);
}

function macrosFromNutrients(nutrients: NutrientPick[]) {
  return {
    energiaKcal: pickEnergyKcal(nutrients),
    proteina: pick(nutrients, ["203"], ["Protein"]),
    grasas: pick(nutrients, ["204"], ["Total lipid (fat)"]),
    carbohidratos: pick(nutrients, ["205"], ["Carbohydrate, by difference"]),
    sodio: pick(nutrients, ["307"], ["Sodium, Na"]),
  };
}

async function usdaFetch(path: string): Promise<unknown> {
  const key = requireUsdaKey();
  const url = `${USDA_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(
      new Error(body.slice(0, 240) || `USDA ${response.status}`),
      { status: response.status === 429 ? 429 : 502, code: "usda_upstream" },
    );
  }
  return response.json();
}

export function usdaSearchHit(food: Record<string, unknown>): CatalogHit | null {
  const fdcId = food.fdcId;
  if (fdcId == null) return null;
  const macros = macrosFromNutrients(nutrientList(food));
  return {
    source: "API",
    ref: String(fdcId),
    nombre: String(food.description ?? food.lowercaseDescription ?? "Alimento USDA").trim(),
    dataType: food.dataType == null ? null : String(food.dataType),
    ...macros,
  };
}

export async function searchUsdaFoods(query: string): Promise<CatalogHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) {
    return cached.items;
  }

  const data = (await usdaFetch(
    `/foods/search?query=${encodeURIComponent(q)}&pageSize=25`,
  )) as Record<string, unknown>;
  const foods = Array.isArray(data.foods) ? data.foods : [];
  const items = foods
    .map((food) => usdaSearchHit((food ?? {}) as Record<string, unknown>))
    .filter((hit): hit is CatalogHit => Boolean(hit));
  searchCache.set(cacheKey, { at: Date.now(), items });
  return items;
}

export async function fetchUsdaFood(fdcId: string): Promise<NutrientSnapshot> {
  const data = (await usdaFetch(`/food/${encodeURIComponent(fdcId)}`)) as Record<string, unknown>;
  const nutrients = nutrientList(data);
  const macros = macrosFromNutrients(nutrients);
  const vitaminas = VITAMIN_MAP.map((entry) => {
    const valor = pick(nutrients, entry.numbers, entry.names);
    return valor ? { nombre: entry.label, valor } : null;
  }).filter((v): v is { nombre: string; valor: number } => Boolean(v));

  return {
    nombre: String(data.description ?? "Ingrediente USDA").trim(),
    referencia: String(data.fdcId ?? fdcId),
    parteAnalizada: data.dataType == null ? null : String(data.dataType),
    proveedor: data.brandOwner == null ? "USDA FoodData Central" : String(data.brandOwner),
    humedad: null,
    grasas: macros.grasas,
    grasaSaturada: pick(nutrients, ["606"], ["Fatty acids, total saturated"]),
    grasaMono: pick(nutrients, ["645"], ["Fatty acids, total monounsaturated"]),
    grasaPoli: pick(nutrients, ["646"], ["Fatty acids, total polyunsaturated"]),
    grasaTrans: pick(nutrients, ["605"], ["Fatty acids, total trans"]),
    colesterol: pick(nutrients, ["601"], ["Cholesterol"]),
    sodio: macros.sodio,
    potasio: pick(nutrients, ["306"], ["Potassium, K"]),
    carbohidratos: macros.carbohidratos,
    fibra: pick(nutrients, ["291"], ["Fiber, total dietary"]),
    fibraSol: pick(nutrients, ["295"], ["Fiber, soluble"]),
    fibraInsol: pick(nutrients, ["296"], ["Fiber, insoluble"]),
    polialcoholes: pick(nutrients, ["1086"], ["Sugar alcohol"]),
    azucar: pick(nutrients, ["269"], ["Sugars, total including NLEA", "Total Sugars"]),
    azucarAdd: pick(nutrients, ["539"], ["Sugars, added"]),
    proteina: macros.proteina,
    energiaKcal: macros.energiaKcal,
    vitaminas,
    aminoacidos: null,
  };
}
