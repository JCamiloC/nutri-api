import type { Request } from "express";
import { DEMO_LAB_ID } from "../config/constants.js";

/** Mientras no hay auth JWT, el lab se toma del header o del demo. */
export function resolveLabId(req: Request): string {
  const header = req.header("x-lab-id");
  if (header && /^[0-9a-f-]{36}$/i.test(header)) return header;
  return DEMO_LAB_ID;
}

export function mapFormula(row: Record<string, unknown>) {
  return {
    id: row.id,
    labId: row.lab_id,
    title: row.title,
    productName: row.product_name,
    brand: row.brand,
    status: row.status,
    packageWeight: Number(row.package_weight),
    weightUnit: row.weight_unit,
    servings: Number(row.servings),
    servingSize: Number(row.serving_size),
    reconstitutedServing: Number(row.reconstituted_serving),
    waterPerServing: Number(row.water_per_serving),
    formulaType: row.formula_type,
    ingredientCount: Number(row.ingredient_count),
    showLogo: row.show_logo,
    sweetener: row.sweetener,
    rsa: row.rsa,
    flavor: row.flavor,
    usageMode: row.usage_mode,
    manufacturedBy: row.manufactured_by,
    manufacturedFor: row.manufactured_for,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFormulaLine(row: Record<string, unknown>) {
  return {
    id: row.id,
    formulaId: row.formula_id,
    ingredientId: row.ingredient_id,
    source: row.source,
    externalRef: row.external_ref,
    name: row.name,
    percent: Number(row.percent),
    sortOrder: Number(row.sort_order),
  };
}

export function mapIngredient(row: Record<string, unknown>) {
  return {
    id: row.id,
    labId: row.lab_id,
    source: row.source,
    referencia: row.referencia,
    nombre: row.nombre,
    parteAnalizada: row.parte_analizada,
    cantidad: Number(row.cantidad),
    unidadMedida: row.unidad_medida,
    costo: Number(row.costo),
    estado: row.estado,
    proveedor: row.proveedor,
    tipo: row.tipo,
    readOnly: row.read_only,
    grasas: Number(row.grasas),
    grasaSaturada: Number(row.grasa_saturada),
    grasaMono: Number(row.grasa_mono),
    grasaPoli: Number(row.grasa_poli),
    grasaTrans: Number(row.grasa_trans),
    colesterol: Number(row.colesterol),
    sodio: Number(row.sodio),
    potasio: Number(row.potasio),
    carbohidratos: Number(row.carbohidratos),
    fibra: Number(row.fibra),
    fibraSol: Number(row.fibra_sol),
    fibraInsol: Number(row.fibra_insol),
    polialcoholes: Number(row.polialcoholes),
    azucar: Number(row.azucar),
    azucarAdd: Number(row.azucar_add),
    proteina: Number(row.proteina),
    energiaKcal: Number(row.energia_kcal),
    humedad: row.humedad === null || row.humedad === undefined ? null : Number(row.humedad),
    vitaminas: row.vitaminas,
    alergenos: row.alergenos,
    aminoacidos: row.aminoacidos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
