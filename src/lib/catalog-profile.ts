export type CatalogHit = {
  source: "ICBF" | "API";
  ref: string;
  nombre: string;
  parteAnalizada?: string | null;
  dataType?: string | null;
  energiaKcal: number;
  proteina: number;
  grasas: number;
  carbohidratos: number;
  sodio: number;
};

export type NutrientSnapshot = {
  nombre: string;
  referencia: string;
  parteAnalizada: string | null;
  proveedor: string | null;
  humedad: number | null;
  grasas: number;
  grasaSaturada: number;
  grasaMono: number;
  grasaPoli: number;
  grasaTrans: number;
  colesterol: number;
  sodio: number;
  potasio: number;
  carbohidratos: number;
  fibra: number;
  fibraSol: number;
  fibraInsol: number;
  polialcoholes: number;
  azucar: number;
  azucarAdd: number;
  proteina: number;
  energiaKcal: number;
  vitaminas: Array<{ nombre: string; valor: number }>;
  aminoacidos: unknown;
};

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseVitaminas(value: unknown): Array<{ nombre: string; valor: number }> {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const nombre = String(row.nombre ?? "").trim();
      const valor = num(row.valor);
      if (!nombre || !valor) return null;
      return { nombre, valor };
    })
    .filter((v): v is { nombre: string; valor: number } => Boolean(v));
}

export function icbfRowToSnapshot(row: Record<string, unknown>): NutrientSnapshot {
  return {
    nombre: String(row.nombre ?? "").trim() || "Alimento ICBF",
    referencia: String(row.codigo ?? "").trim(),
    parteAnalizada: row.parte_analizada == null ? null : String(row.parte_analizada),
    proveedor: String(row.fuente ?? "ICBF"),
    humedad: row.humedad == null ? null : num(row.humedad),
    grasas: num(row.grasas),
    grasaSaturada: num(row.grasa_saturada),
    grasaMono: num(row.grasa_mono),
    grasaPoli: num(row.grasa_poli),
    grasaTrans: num(row.grasa_trans),
    colesterol: num(row.colesterol),
    sodio: num(row.sodio),
    potasio: num(row.potasio),
    carbohidratos: num(row.carbohidratos),
    fibra: num(row.fibra),
    fibraSol: num(row.fibra_sol),
    fibraInsol: num(row.fibra_insol),
    polialcoholes: num(row.polialcoholes),
    azucar: num(row.azucar),
    azucarAdd: num(row.azucar_add),
    proteina: num(row.proteina),
    energiaKcal: num(row.energia_kcal),
    vitaminas: parseVitaminas(row.vitaminas),
    aminoacidos: row.aminoacidos ?? null,
  };
}

export function icbfRowToHit(row: Record<string, unknown>): CatalogHit {
  return {
    source: "ICBF",
    ref: String(row.codigo ?? "").trim(),
    nombre: String(row.nombre ?? "").trim(),
    parteAnalizada: row.parte_analizada == null ? null : String(row.parte_analizada),
    energiaKcal: num(row.energia_kcal),
    proteina: num(row.proteina),
    grasas: num(row.grasas),
    carbohidratos: num(row.carbohidratos),
    sodio: num(row.sodio),
  };
}
