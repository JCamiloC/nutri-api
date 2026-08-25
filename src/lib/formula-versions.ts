import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type VersionSnapshot = {
  formula: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
  printedAt: string;
  printedBy: string | null;
};

export function nextVersionLabel(seq: number): string {
  if (seq <= 1) return "1.0";
  // 1.0, 1.1, 1.2… (secuencial comercial simple)
  return `1.${seq - 1}`;
}

/** Hash estable del contenido vendible (borrador + macros congelados). */
export function hashFormulaContent(input: {
  formula: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}): string {
  const payload = {
    title: input.formula.title,
    productName: input.formula.productName ?? input.formula.product_name,
    brand: input.formula.brand,
    formulaType: input.formula.formulaType ?? input.formula.formula_type,
    packageWeight: Number(input.formula.packageWeight ?? input.formula.package_weight),
    servings: Number(input.formula.servings),
    servingSize: Number(input.formula.servingSize ?? input.formula.serving_size),
    reconstitutedServing: Number(
      input.formula.reconstitutedServing ?? input.formula.reconstituted_serving ?? 0,
    ),
    waterPerServing: Number(input.formula.waterPerServing ?? input.formula.water_per_serving ?? 0),
    showLogo: input.formula.showLogo ?? input.formula.show_logo,
    showWatermark: input.formula.showWatermark ?? input.formula.show_watermark,
    manufacturedBy: input.formula.manufacturedBy ?? input.formula.manufactured_by,
    manufacturedFor: input.formula.manufacturedFor ?? input.formula.manufactured_for,
    lines: input.lines.map((l) => ({
      ingredientId: l.ingredientId ?? l.ingredient_id,
      source: l.source,
      name: l.name,
      percent: Number(l.percent),
      per100g: l.per100g,
    })),
    calories: input.result.calories,
    nutrients: input.result.nutrients,
    ingredientList: input.result.ingredientList,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function mapFormulaVersion(row: Record<string, unknown>) {
  return {
    id: row.id,
    formulaId: row.formula_id,
    labId: row.lab_id,
    versionLabel: row.version_label,
    versionSeq: Number(row.version_seq),
    billable: row.billable === true,
    contentHash: row.content_hash,
    snapshot: row.snapshot,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at,
  };
}

export async function getLatestVersion(client: PoolClient, formulaId: string) {
  const res = await client.query(
    `SELECT * FROM formula_versions
     WHERE formula_id = $1
     ORDER BY version_seq DESC
     LIMIT 1`,
    [formulaId],
  );
  return res.rows[0] ?? null;
}

export async function insertFormulaVersion(
  client: PoolClient,
  args: {
    formulaId: string;
    labId: string;
    contentHash: string;
    snapshot: VersionSnapshot;
    createdByUserId: string | null;
    billable: boolean;
  },
) {
  const seqRes = await client.query(
    `SELECT COALESCE(MAX(version_seq), 0)::int AS n
     FROM formula_versions WHERE formula_id = $1`,
    [args.formulaId],
  );
  const nextSeq = Number(seqRes.rows[0]?.n ?? 0) + 1;
  const label = nextVersionLabel(nextSeq);

  const inserted = await client.query(
    `INSERT INTO formula_versions (
      formula_id, lab_id, version_label, version_seq, billable,
      content_hash, snapshot, created_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    RETURNING *`,
    [
      args.formulaId,
      args.labId,
      label,
      nextSeq,
      args.billable,
      args.contentHash,
      JSON.stringify(args.snapshot),
      args.createdByUserId,
    ],
  );
  return inserted.rows[0];
}
