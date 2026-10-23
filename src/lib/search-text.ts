/** Pares para translate() en PostgreSQL (misma longitud). Aplicar lower() antes. */
const PG_TRANSLATE_FROM = "áéíóúüñàèìòù";
const PG_TRANSLATE_TO = "aeiouunaeiou";

/** Normaliza en JS (filtros locales, tests). */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** LIKE insensible a mayúsculas y tildes: `column` vs placeholder `$n`. */
export function sqlAccentInsensitiveLike(column: string, paramIndex: number): string {
  const folded = `translate(lower(${column}), '${PG_TRANSLATE_FROM}', '${PG_TRANSLATE_TO}')`;
  const pattern = `translate(lower($${paramIndex}), '${PG_TRANSLATE_FROM}', '${PG_TRANSLATE_TO}')`;
  return `${folded} LIKE ${pattern}`;
}

/** Patrón con comodines para búsqueda parcial. */
export function likePattern(rawQuery: string): string {
  return `%${rawQuery.trim()}%`;
}
