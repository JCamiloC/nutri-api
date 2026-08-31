/**
 * Lectura compartida de tablas de composición estilo ICBF
 * (fila 0 título agrupado, fila 1 encabezados, datos desde fila 2).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

export const COMPOSITION_DATA_START = 2;

export const COL = {
  codigo: 0,
  fuente: 1,
  nombre: 2,
  parteAnalizada: 3,
  humedad: 4,
  energiaKcal: 5,
  proteina: 7,
  grasas: 8,
  carbohidratos: 9,
  fibra: 11,
  calcio: 13,
  hierro: 14,
  sodio: 15,
  fosforo: 16,
  yodo: 17,
  zinc: 18,
  magnesio: 19,
  potasio: 20,
  tiamina: 21,
  riboflavina: 22,
  niacina: 23,
  folatos: 24,
  vitaminaB12: 25,
  vitaminaC: 26,
  vitaminaA: 27,
  grasaSaturada: 28,
  grasaMono: 29,
  grasaPoli: 30,
  colesterol: 31,
} as const;

export type CompositionRecord = {
  codigo: string;
  nombre: string;
  parteAnalizada: string | null;
  fuente: string;
  humedad: number | null;
  energiaKcal: number;
  proteina: number;
  grasas: number;
  grasaSaturada: number;
  grasaMono: number;
  grasaPoli: number;
  colesterol: number;
  carbohidratos: number;
  fibra: number;
  sodio: number;
  potasio: number;
  vitaminas: Array<{ nombre: string; valor: number }>;
  aminoacidos: Record<string, number> | null;
};

export function num(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Vacío / inválido → 0 (política de importación a producción). */
export function n0(value: unknown): number {
  return num(value) ?? 0;
}

export function buildVitaminas(row: unknown[]): Array<{ nombre: string; valor: number }> {
  const yodo = num(row[COL.yodo]);
  const entries: Array<[string, number | null]> = [
    ["Vitamina A", num(row[COL.vitaminaA])],
    ["Vitamina C", num(row[COL.vitaminaC])],
    ["Calcio", num(row[COL.calcio])],
    ["Hierro", num(row[COL.hierro])],
    ["Vitamina B1", num(row[COL.tiamina])],
    ["Vitamina B2", num(row[COL.riboflavina])],
    ["Niacina", num(row[COL.niacina])],
    ["Ácido fólico", num(row[COL.folatos])],
    ["Vitamina B12", num(row[COL.vitaminaB12])],
    ["Fósforo", num(row[COL.fosforo])],
    ["Yodo", yodo != null ? yodo * 1000 : null],
    ["Magnesio", num(row[COL.magnesio])],
    ["Zinc", num(row[COL.zinc])],
    ["Potasio", num(row[COL.potasio])],
  ];
  return entries
    .filter((entry): entry is [string, number] => entry[1] != null && entry[1] !== 0)
    .map(([nombre, valor]) => ({ nombre, valor }));
}

export function buildAminoacidos(row: unknown[]): Record<string, number> | null {
  const labels = [
    "Ácido Aspártico",
    "Treonina",
    "Serina",
    "Ácido Glutámico",
    "Prolina",
    "Glicina",
    "Alanina",
    "Cisteina",
    "Valina",
    "Metionina",
    "Isoleucina",
    "Leucina",
    "Tirosina",
    "Fenilalanina",
    "Histidina",
    "Lisina",
    "Arginina",
    "Triptofano",
  ];
  const amino: Record<string, number> = {};
  labels.forEach((label, offset) => {
    const value = num(row[32 + offset]);
    if (value !== null) amino[label] = value;
  });
  return Object.keys(amino).length ? amino : null;
}

export function rowToComposition(
  row: unknown[],
  defaultFuente: string,
): CompositionRecord | null {
  const codigo = String(row[COL.codigo] ?? "").trim();
  const nombre = String(row[COL.nombre] ?? "").trim();
  if (!codigo || !nombre) return null;
  return {
    codigo,
    nombre,
    parteAnalizada: String(row[COL.parteAnalizada] ?? "").trim() || null,
    fuente: String(row[COL.fuente] ?? defaultFuente).trim() || defaultFuente,
    humedad: num(row[COL.humedad]),
    energiaKcal: n0(row[COL.energiaKcal]),
    proteina: n0(row[COL.proteina]),
    grasas: n0(row[COL.grasas]),
    grasaSaturada: n0(row[COL.grasaSaturada]),
    grasaMono: n0(row[COL.grasaMono]),
    grasaPoli: n0(row[COL.grasaPoli]),
    colesterol: n0(row[COL.colesterol]),
    carbohidratos: n0(row[COL.carbohidratos]),
    fibra: n0(row[COL.fibra]),
    sodio: n0(row[COL.sodio]),
    potasio: n0(row[COL.potasio]),
    vitaminas: buildVitaminas(row),
    aminoacidos: buildAminoacidos(row),
  };
}

export function readCompositionSheet(
  excelPath: string,
  opts?: { sheetName?: string | RegExp; defaultFuente?: string },
): CompositionRecord[] {
  const workbook = XLSX.readFile(excelPath);
  let sheetName = workbook.SheetNames[0];
  if (opts?.sheetName) {
    if (typeof opts.sheetName === "string") {
      sheetName = opts.sheetName;
    } else {
      sheetName =
        workbook.SheetNames.find((n) => opts.sheetName instanceof RegExp && opts.sheetName.test(n)) ??
        sheetName;
    }
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Hoja no encontrada en ${excelPath}: ${String(opts?.sheetName ?? sheetName)}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];
  const defaultFuente = opts?.defaultFuente ?? "ICBF";
  return rows
    .slice(COMPOSITION_DATA_START)
    .map((row) => rowToComposition(row, defaultFuente))
    .filter((r): r is CompositionRecord => Boolean(r));
}
