import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { resolveLabId } from "../lib/mappers.js";
import { getLabCapacity } from "../lib/quota.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";

export const usersRouter = Router();

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

function mapLabUser(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role) as "lab_admin" | "lab_reader",
    active: row.active !== false,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
  };
}

function generateTempPassword() {
  return randomBytes(5).toString("base64url").slice(0, 10);
}

async function countActiveAdmins(labId: string, excludeUserId?: string) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM users
     WHERE lab_id = $1
       AND role = 'lab_admin'
       AND active = true
       AND ($2::uuid IS NULL OR id <> $2)`,
    [labId, excludeUserId ?? null],
  );
  return Number(result.rows[0]?.n ?? 0);
}

usersRouter.get("/v1/lab/users", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, role, active, created_at
       FROM users
       WHERE lab_id = $1
         AND role IN ('lab_admin', 'lab_reader')
       ORDER BY
         CASE WHEN role = 'lab_admin' THEN 0 ELSE 1 END,
         lower(name) ASC`,
      [labId],
    );
    const capacity = await getLabCapacity(labId);
    return res.json({
      items: result.rows.map(mapLabUser),
      adminsUsed: capacity?.adminsUsed ?? 0,
      adminSeats: capacity?.adminSeats ?? 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_users_failed", message });
  }
});

const inviteBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(["lab_admin", "lab_reader"]),
  password: z.string().min(6).max(72).optional(),
});

usersRouter.post("/v1/lab/users", requireAuth, requireWrite, async (req, res) => {
  const parsed = inviteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const data = parsed.data;
    const email = data.email.toLowerCase();

    if (data.role === "lab_admin") {
      const capacity = await getLabCapacity(labId);
      if (!capacity) {
        return res.status(404).json({ error: "lab_not_found" });
      }
      if (capacity.adminsUsed >= capacity.adminSeats) {
        return res.status(403).json({
          error: "admin_seats_exceeded",
          message: `Cupo de admins agotado (${capacity.adminsUsed}/${capacity.adminSeats}). Cambia a rol lectura o solicita un plan superior.`,
          capacity,
        });
      }
    }

    const tempPassword = data.password ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const pool = getPool();

    try {
      const insert = await pool.query(
        `INSERT INTO users (lab_id, email, name, password_hash, role, active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, email, name, role, active, created_at`,
        [labId, email, data.name, passwordHash, data.role],
      );

      const user = mapLabUser(insert.rows[0]);
      await writeAudit(req, {
        labId,
        action: "user.invite",
        detail: `${user.email} · ${user.role}`,
      });

      return res.status(201).json({
        user,
        temporaryPassword: data.password ? undefined : tempPassword,
        message: data.password
          ? "Usuario creado"
          : "Usuario creado. Comparte la contraseña temporal de forma segura.",
      });
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "23505") {
        return res.status(409).json({
          error: "email_taken",
          message: "Ya existe un usuario con ese correo",
        });
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "invite_user_failed", message });
  }
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["lab_admin", "lab_reader"]).optional(),
  active: z.boolean().optional(),
});

usersRouter.patch("/v1/lab/users/:id", requireAuth, requireWrite, async (req, res) => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const pool = getPool();
    const existing = await pool.query(
      `SELECT id, email, name, role, active, created_at
       FROM users
       WHERE id = $1 AND lab_id = $2 AND role IN ('lab_admin', 'lab_reader')`,
      [req.params.id, labId],
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }

    const current = existing.rows[0];
    const d = parsed.data;
    const nextRole = d.role ?? String(current.role);
    const nextActive = d.active ?? Boolean(current.active);
    const wasAdmin = String(current.role) === "lab_admin" && current.active !== false;
    const willBeAdmin = nextRole === "lab_admin" && nextActive;

    if (req.user?.id === String(current.id) && d.active === false) {
      return res.status(400).json({
        error: "cannot_deactivate_self",
        message: "No puedes desactivar tu propio usuario",
      });
    }

    if (wasAdmin && !willBeAdmin) {
      const remainingAdmins = await countActiveAdmins(labId, String(current.id));
      if (remainingAdmins < 1) {
        return res.status(400).json({
          error: "last_admin",
          message: "Debe quedar al menos un admin activo en el laboratorio",
        });
      }
    }

    if (!wasAdmin && willBeAdmin) {
      const capacity = await getLabCapacity(labId);
      if (capacity && capacity.adminsUsed >= capacity.adminSeats) {
        return res.status(403).json({
          error: "admin_seats_exceeded",
          message: `Cupo de admins agotado (${capacity.adminsUsed}/${capacity.adminSeats}).`,
          capacity,
        });
      }
    }

    const updated = await pool.query(
      `UPDATE users SET
         name = COALESCE($3, name),
         role = COALESCE($4, role),
         active = COALESCE($5, active)
       WHERE id = $1 AND lab_id = $2
       RETURNING id, email, name, role, active, created_at`,
      [
        req.params.id,
        labId,
        d.name ?? null,
        d.role ?? null,
        typeof d.active === "boolean" ? d.active : null,
      ],
    );

    const user = mapLabUser(updated.rows[0]);
    await writeAudit(req, {
      labId,
      action: "user.update",
      detail: `${user.email} · ${user.role} · ${user.active ? "activo" : "inactivo"}`,
    });

    return res.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_user_failed", message });
  }
});
