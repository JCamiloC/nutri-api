/** Validaciones de fórmula alineadas a Enerxis. */

export const PERCENT_TOLERANCE = 0.01;

export function isPercentComplete(total: number): boolean {
  return Math.abs(total - 100) <= PERCENT_TOLERANCE;
}

export type FormulaValidationIssue = {
  code: string;
  message: string;
};

export function validateFormulaDraft(input: {
  title?: string | null;
  formulaType?: string | null;
  lines?: Array<{ percent?: number; name?: string }> | null;
  requireLines?: boolean;
  requireCompletePercent?: boolean;
}): FormulaValidationIssue[] {
  const issues: FormulaValidationIssue[] = [];
  const title = (input.title ?? "").trim();
  if (!title) {
    issues.push({ code: "title_required", message: "Ingresa un título para la fórmula" });
  }

  if (!input.formulaType) {
    issues.push({ code: "formula_type_required", message: "Selecciona el tipo de fórmula" });
  }

  const lines = input.lines ?? [];
  if (input.requireLines && lines.length === 0) {
    issues.push({
      code: "lines_required",
      message: "Agrega al menos un ingrediente",
    });
  }

  for (const line of lines) {
    if (!line.name?.trim()) {
      issues.push({ code: "line_name_required", message: "Cada línea necesita nombre de ingrediente" });
      break;
    }
  }

  const total = lines.reduce((acc, line) => acc + (Number(line.percent) || 0), 0);
  if (input.requireCompletePercent && lines.length > 0 && !isPercentComplete(total)) {
    issues.push({
      code: "percent_incomplete",
      message: `La suma de porcentajes debe ser 100% (actual: ${total.toFixed(2)}%)`,
    });
  }

  return issues;
}
