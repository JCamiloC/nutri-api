import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, signAccessToken } from "../middleware/auth.js";
import type { UserRole } from "../types/auth.js";

export const authRouter = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/v1/auth/login", async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, password_hash, role, lab_id, active
       FROM users WHERE lower(email) = $1 LIMIT 1`,
      [email],
    );
    const user = result.rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: "invalid_credentials", message: "Email o contraseña incorrectos" });
    }
    if (!user.password_hash) {
      return res.status(401).json({ error: "invalid_credentials", message: "Usuario sin contraseña configurada" });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "invalid_credentials", message: "Email o contraseña incorrectos" });
    }

    const authUser = {
      id: user.id as string,
      email: user.email as string,
      name: user.name as string,
      role: user.role as UserRole,
      labId: (user.lab_id as string | null) ?? null,
    };

    const token = signAccessToken(authUser);
    req.user = authUser;
    await writeAudit(req, {
      labId: authUser.labId,
      action: "login",
      detail: `Inicio de sesión · ${authUser.email} · ${authUser.role}`,
    });

    return res.json({
      token,
      user: {
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
        role: authUser.role,
        labId: authUser.labId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "login_failed", message });
  }
});

authRouter.get("/v1/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: req.user });
});
