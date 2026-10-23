export const TECHNOLOGICAL_FUNCTION_OTHER =
  "Otros (especificar en observaciones)";

export function technologicalFunctionLabelText(
  fn?: string | null,
  notes?: string | null,
): string | null {
  const f = fn?.trim();
  if (!f) return null;
  if (f === TECHNOLOGICAL_FUNCTION_OTHER) {
    const n = notes?.trim();
    return n || null;
  }
  return f;
}
