import { technologicalFunctionLabelText } from "./technological-functions.js";

/** Entrada de listado: nombre + función tecnológica opcional entre paréntesis (minúsculas). */
export function formatIngredientListEntry(
  name: string,
  technologicalFunction?: string | null,
  technologicalFunctionNotes?: string | null,
): string {
  const trimmedName = name.trim();
  if (!trimmedName) return "";
  const fn = technologicalFunctionLabelText(
    technologicalFunction,
    technologicalFunctionNotes,
  );
  if (!fn) return trimmedName;
  return `${trimmedName} (${fn.toLocaleLowerCase("es")})`;
}
