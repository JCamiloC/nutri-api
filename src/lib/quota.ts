import { getPool } from "../db/pool.js";

export type PlanRow = {
  id: string;
  name: string;
  price_monthly: number;
  tables_included: number;
  admin_seats: number;
  readers_unlimited: boolean;
  pdf_export: boolean;
  label_preview: boolean;
  audit_log: boolean;
  highlight: boolean;
  description: string;
};

export function mapPlan(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    priceMonthly: Number(row.price_monthly ?? 0),
    tablesIncluded: Number(row.tables_included ?? 0),
    adminSeats: Number(row.admin_seats ?? 1),
    readersUnlimited: row.readers_unlimited !== false,
    pdfExport: row.pdf_export !== false,
    labelPreview: row.label_preview !== false,
    auditLog: row.audit_log !== false,
    highlight: Boolean(row.highlight),
    description: String(row.description ?? ""),
  };
}

export function mapExtraPack(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    tables: Number(row.tables_count ?? 0),
    price: Number(row.price ?? 0),
    description: String(row.description ?? ""),
  };
}

export type LabCapacity = {
  planId: string | null;
  plan: ReturnType<typeof mapPlan> | null;
  tablesIncluded: number;
  tablesExtra: number;
  total: number;
  /** Fórmulas ya impresas/exportadas (cobran 1 cupo). */
  used: number;
  /** Borradores / listas sin imprimir (no gastan cupo). */
  drafts: number;
  remaining: number;
  pct: number;
  renewsAt: string | null;
  status: string;
  name: string;
  adminsUsed: number;
  adminSeats: number;
};

function formatDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export async function getLabCapacity(labId: string): Promise<LabCapacity | null> {
  const pool = getPool();
  const labRes = await pool.query(`SELECT * FROM labs WHERE id = $1`, [labId]);
  const lab = labRes.rows[0];
  if (!lab) return null;

  const planId = (lab.plan_id as string | null) ?? null;
  let plan: ReturnType<typeof mapPlan> | null = null;
  if (planId) {
    const planRes = await pool.query(`SELECT * FROM plans WHERE id = $1`, [planId]);
    if (planRes.rows[0]) plan = mapPlan(planRes.rows[0]);
  }

  const countRes = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'exportada')::int AS used,
       count(*) FILTER (WHERE status IS DISTINCT FROM 'exportada')::int AS drafts
     FROM formulas
     WHERE lab_id = $1`,
    [labId],
  );
  const used = Number(countRes.rows[0]?.used ?? 0);
  const drafts = Number(countRes.rows[0]?.drafts ?? 0);

  const adminsRes = await pool.query(
    `SELECT count(*)::int AS n FROM users
     WHERE lab_id = $1 AND role = 'lab_admin' AND active = true`,
    [labId],
  );
  const adminsUsed = Number(adminsRes.rows[0]?.n ?? 0);

  const tablesIncluded = plan?.tablesIncluded ?? 0;
  const tablesExtra = Number(lab.tables_extra ?? 0);
  const total = tablesIncluded + tablesExtra;
  const remaining = Math.max(0, total - used);
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return {
    planId,
    plan,
    tablesIncluded,
    tablesExtra,
    total,
    used,
    drafts,
    remaining,
    pct,
    renewsAt: formatDate(lab.renews_at),
    status: String(lab.status),
    name: String(lab.name),
    adminsUsed,
    adminSeats: plan?.adminSeats ?? 1,
  };
}
