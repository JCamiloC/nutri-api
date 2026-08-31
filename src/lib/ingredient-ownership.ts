import type { Request } from "express";

export type IngredientRow = Record<string, unknown>;

export function isIngredientEditable(
  row: IngredientRow,
  viewer: { id: string; role?: string; labId?: string | null } | null | undefined,
): boolean {
  if (!viewer) return false;
  if (row.source !== "BD") return false;

  // Base global Enerxis: solo personal Enerxis (superadmin) puede editar.
  // Clientes la ven/usan y duplican a su inventario.
  if (row.is_base === true) {
    return viewer.role === "superadmin";
  }

  if (row.read_only === true) return false;

  const createdBy = row.created_by_user_id == null ? null : String(row.created_by_user_id);
  if (createdBy) return createdBy === viewer.id;

  // Legacy sin dueño: editable solo dentro del mismo lab (admins)
  if (viewer.role === "lab_reader") return false;
  if (viewer.labId && row.lab_id && String(row.lab_id) === viewer.labId) return true;
  // Sin dueño y sin lab propio: no editable (base/global)
  return false;
}

/** Visible en catálogo compartido: base + todo BD + attaches ICBF/USDA del lab. */
export function ingredientVisibilitySql(labParamIndex: number) {
  return `(
    is_base = true
    OR source = 'BD'
    OR lab_id = $${labParamIndex}
  )`;
}

export function canResolveIngredientForFormula(
  row: IngredientRow,
  labId: string,
): boolean {
  if (row.is_base === true) return true;
  if (row.source === "BD") return true;
  return String(row.lab_id ?? "") === labId;
}

export function ownershipKind(
  row: IngredientRow,
  viewer?: { id?: string | null; labId?: string | null } | null,
): "verified" | "mine" | "other" {
  if (row.source === "ICBF" || row.source === "API") return "verified";
  if (row.is_base === true) return "other";
  const createdBy = row.created_by_user_id == null ? null : String(row.created_by_user_id);
  if (viewer?.id && createdBy === viewer.id) return "mine";
  // Legacy: BD del mismo lab sin dueño → tratar como mío
  if (
    !createdBy &&
    viewer?.labId &&
    row.lab_id &&
    String(row.lab_id) === viewer.labId &&
    row.source === "BD"
  ) {
    return "mine";
  }
  return "other";
}

export function viewerFromReq(req: Request) {
  if (!req.user) return null;
  return {
    id: req.user.id,
    role: req.user.role,
    labId: req.user.labId,
  };
}
