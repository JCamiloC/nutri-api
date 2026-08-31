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
  /** Versiones billable emitidas en el ciclo actual (1 cupo c/u). */
  used: number;
  /** Borradores / listas sin imprimir (no gastan cupo). */
  drafts: number;
  remaining: number;
  pct: number;
  /** Próxima renovación (= fin del ciclo, YYYY-MM-DD). */
  renewsAt: string | null;
  /** Inicio inclusivo del ciclo actual (YYYY-MM-DD). */
  cycleStart: string | null;
  /** Fin exclusivo del ciclo (= renewsAt). */
  cycleEnd: string | null;
  /** true si al consultar se avanzó renews_at por ciclos vencidos. */
  cycleRolled: boolean;
  status: string;
  name: string;
  adminsUsed: number;
  adminSeats: number;
};

export type BillingCycle = {
  /** Inicio inclusivo del ciclo. */
  cycleStart: Date;
  /** Fin exclusivo (= próxima renovación). */
  cycleEnd: Date;
  /** YYYY-MM-DD de cycleEnd. */
  renewsAt: string;
  /** Se avanzó al menos un mes porque renews_at estaba vencido. */
  rolled: boolean;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Suma meses en calendario UTC (día anclado; si no existe, último día del mes). */
export function addUtcMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOnly(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return startOfUtcDay(value);
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return startOfUtcDay(d);
  return null;
}

/**
 * Ciclo comercial mensual anclado a `labs.renews_at` (próxima renovación).
 * Ciclo vigente: [renewsAt − 1 mes, renewsAt).
 * Si renews_at ≤ hoy, avanza de mes en mes hasta quedar en el futuro
 * (el cupo base se “reinicia” solo: used cuenta emisiones del nuevo ciclo).
 */
export function resolveBillingCycle(
  renewsAtRaw: unknown,
  now: Date = new Date(),
): BillingCycle {
  const today = startOfUtcDay(now);
  let cycleEnd = parseDateOnly(renewsAtRaw);
  let rolled = false;

  if (!cycleEnd) {
    cycleEnd = addUtcMonths(today, 1);
    rolled = true;
  }

  while (cycleEnd.getTime() <= today.getTime()) {
    cycleEnd = addUtcMonths(cycleEnd, 1);
    rolled = true;
  }

  const cycleStart = addUtcMonths(cycleEnd, -1);
  return {
    cycleStart,
    cycleEnd,
    renewsAt: toDateString(cycleEnd),
    rolled,
  };
}

/**
 * Si el ciclo venció, persiste el nuevo renews_at y pone extras en 0
 * (packs son del mes en curso; el cupo base del plan vuelve limpio).
 */
async function persistCycleRoll(
  labId: string,
  renewsAt: string,
): Promise<{ tablesExtra: number }> {
  const pool = getPool();
  const res = await pool.query(
    `UPDATE labs
     SET renews_at = $2::date,
         tables_extra = 0,
         updated_at = now()
     WHERE id = $1
     RETURNING tables_extra`,
    [labId, renewsAt],
  );
  return { tablesExtra: Number(res.rows[0]?.tables_extra ?? 0) };
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

  const cycle = resolveBillingCycle(lab.renews_at);
  let tablesExtra = Number(lab.tables_extra ?? 0);

  if (cycle.rolled) {
    const persisted = await persistCycleRoll(labId, cycle.renewsAt);
    tablesExtra = persisted.tablesExtra;
  }

  const countRes = await pool.query(
    `SELECT
       (
         SELECT count(*)::int FROM formula_versions
         WHERE lab_id = $1
           AND billable = true
           AND created_at >= $2::timestamptz
           AND created_at < $3::timestamptz
       ) AS used,
       (
         SELECT count(*)::int FROM formulas
         WHERE lab_id = $1 AND status IS DISTINCT FROM 'exportada'
       ) AS drafts`,
    [labId, cycle.cycleStart.toISOString(), cycle.cycleEnd.toISOString()],
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
    renewsAt: cycle.renewsAt,
    cycleStart: toDateString(cycle.cycleStart),
    cycleEnd: cycle.renewsAt,
    cycleRolled: cycle.rolled,
    status: String(lab.status),
    name: String(lab.name),
    adminsUsed,
    adminSeats: plan?.adminSeats ?? 1,
  };
}
