import type { Request } from "express";
import { getPool } from "../db/pool.js";

export async function writeAudit(
  req: Request,
  input: {
    labId?: string | null;
    action: string;
    detail?: string;
  },
) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_events (lab_id, actor_user_id, actor_name, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.labId ?? req.user?.labId ?? null,
        req.user?.id ?? null,
        req.user?.name ?? req.user?.email ?? "sistema",
        input.action,
        input.detail ?? null,
      ],
    );
  } catch (error) {
    console.error("[audit] failed:", error instanceof Error ? error.message : error);
  }
}
