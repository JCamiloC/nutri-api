import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { resolveLabId } from "../lib/mappers.js";
import { requireAuth } from "../middleware/auth.js";

export const auditRouter = Router();

function getLabId(
  req: Parameters<typeof resolveLabId>[0],
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
) {
  try {
    return resolveLabId(req);
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string };
    res.status(err.status ?? 403).json({
      error: err.code ?? "lab_required",
      message: err.message ?? "Laboratorio requerido",
    });
    return null;
  }
}

function mapAuditEvent(row: Record<string, unknown>) {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? "");
  return {
    id: String(row.id),
    labId: row.lab_id ? String(row.lab_id) : null,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorName: String(row.actor_name ?? "sistema"),
    action: String(row.action),
    detail: row.detail != null ? String(row.detail) : null,
    createdAt,
  };
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  action: z.string().trim().min(1).max(80).optional(),
});

/**
 * Listado de auditoría del laboratorio.
 * Lectores también pueden ver (transparencia del lab); escritura no aplica.
 */
auditRouter.get("/v1/lab/audit", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }

  try {
    const labId = getLabId(req, res);
    if (!labId) return;

    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const actionFilter = parsed.data.action ?? null;
    const pool = getPool();

    const countRes = await pool.query(
      `SELECT count(*)::int AS n
       FROM audit_events
       WHERE lab_id = $1
         AND ($2::text IS NULL OR action = $2)`,
      [labId, actionFilter],
    );
    const total = Number(countRes.rows[0]?.n ?? 0);

    const result = await pool.query(
      `SELECT id, lab_id, actor_user_id, actor_name, action, detail, created_at
       FROM audit_events
       WHERE lab_id = $1
         AND ($2::text IS NULL OR action = $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [labId, actionFilter, limit, offset],
    );

    return res.json({
      items: result.rows.map(mapAuditEvent),
      total,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_audit_failed", message });
  }
});
