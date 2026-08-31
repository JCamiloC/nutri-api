import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import {
  hashToken,
  issueRefreshToken,
  newOpaqueToken,
  passwordResetExpiresAt,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../lib/auth-tokens.js";
import { appPublicUrl, sendMail, smtpConfigured } from "../lib/mailer.js";
import { requireAuth, signAccessToken } from "../middleware/auth.js";
import type { UserRole } from "../types/auth.js";

export const authRouter = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

const forgotBody = z.object({
  email: z.string().email(),
});

const resetBody = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(72),
});

const refreshBody = z.object({
  refreshToken: z.string().min(20),
});

const logoutBody = z.object({
  refreshToken: z.string().min(20).optional(),
  all: z.boolean().optional(),
});

function clientMeta(req: { get?: (h: string) => string | undefined; ip?: string }) {
  return {
    userAgent: req.get?.("user-agent") ?? null,
    ip: req.ip ?? null,
  };
}

function mapAuthUser(row: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  lab_id: string | null;
}) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    labId: row.lab_id ?? null,
  };
}

async function loadActiveUser(userId: string) {
  const result = await getPool().query(
    `SELECT id, email, name, password_hash, role, lab_id, active
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user || !user.active) return null;
  return user;
}

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
      return res.status(401).json({
        error: "invalid_credentials",
        message: "Email o contraseña incorrectos",
      });
    }
    if (!user.password_hash) {
      return res.status(401).json({
        error: "invalid_credentials",
        message: "Usuario sin contraseña configurada",
      });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({
        error: "invalid_credentials",
        message: "Email o contraseña incorrectos",
      });
    }

    const authUser = mapAuthUser(user);
    const token = signAccessToken(authUser);
    const { refreshToken } = await issueRefreshToken(pool, authUser.id, clientMeta(req));

    req.user = authUser;
    await writeAudit(req, {
      labId: authUser.labId,
      action: "login",
      detail: `Inicio de sesión · ${authUser.email} · ${authUser.role}`,
    });

    return res.json({
      token,
      accessToken: token,
      refreshToken,
      user: authUser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "login_failed", message });
  }
});

authRouter.post("/v1/auth/refresh", async (req, res) => {
  const parsed = refreshBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const pool = getPool();
    const rotated = await rotateRefreshToken(pool, parsed.data.refreshToken, clientMeta(req));
    if (!rotated) {
      return res.status(401).json({
        error: "invalid_refresh",
        message: "Sesión expirada o revocada. Inicia sesión de nuevo.",
      });
    }

    const user = await loadActiveUser(rotated.userId);
    if (!user) {
      await revokeAllRefreshTokens(pool, rotated.userId);
      return res.status(401).json({
        error: "invalid_refresh",
        message: "Usuario inactivo",
      });
    }

    const authUser = mapAuthUser(user);
    const token = signAccessToken(authUser);
    return res.json({
      token,
      accessToken: token,
      refreshToken: rotated.refreshToken,
      user: authUser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "refresh_failed", message });
  }
});

authRouter.post("/v1/auth/logout", requireAuth, async (req, res) => {
  const parsed = logoutBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const pool = getPool();
    const userId = req.user!.id;
    let revoked = 0;

    if (parsed.data.all) {
      revoked = await revokeAllRefreshTokens(pool, userId);
    } else if (parsed.data.refreshToken) {
      const ok = await revokeRefreshToken(pool, parsed.data.refreshToken);
      revoked = ok ? 1 : 0;
    } else {
      revoked = await revokeAllRefreshTokens(pool, userId);
    }

    await writeAudit(req, {
      labId: req.user!.labId,
      action: "logout",
      detail: parsed.data.all || !parsed.data.refreshToken ? "logout all" : "logout",
    });

    return res.json({ ok: true, revoked });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "logout_failed", message });
  }
});

authRouter.post("/v1/auth/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      message: "La nueva contraseña debe tener al menos 8 caracteres.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const pool = getPool();
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT id, password_hash FROM users WHERE id = $1 AND active = true LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row?.password_hash) {
      return res.status(400).json({ error: "no_password", message: "Usuario sin contraseña" });
    }

    const ok = await bcrypt.compare(parsed.data.currentPassword, row.password_hash);
    if (!ok) {
      return res.status(400).json({
        error: "invalid_current_password",
        message: "La contraseña actual no es correcta",
      });
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({
        error: "same_password",
        message: "La nueva contraseña debe ser distinta a la actual",
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $2, password_changed_at = now()
       WHERE id = $1`,
      [userId, passwordHash],
    );

    const revoked = await revokeAllRefreshTokens(pool, userId);
    const { refreshToken } = await issueRefreshToken(pool, userId, clientMeta(req));
    const token = signAccessToken(req.user!);

    await writeAudit(req, {
      labId: req.user!.labId,
      action: "password.change",
      detail: `Contraseña actualizada · sesiones previas revocadas (${revoked})`,
    });

    return res.json({
      ok: true,
      token,
      accessToken: token,
      refreshToken,
      message: "Contraseña actualizada. Otras sesiones quedaron cerradas.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "change_password_failed", message });
  }
});

/**
 * Forgot password. Sin SMTP: registra token en mock/dev y responde smtpPending.
 * Siempre 200 genérico (no enumerar emails), salvo error interno.
 */
authRouter.post("/v1/auth/forgot-password", async (req, res) => {
  const parsed = forgotBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const generic = {
    ok: true,
    message:
      "Si el correo existe, recibirás instrucciones para restablecer la contraseña.",
  };

  try {
    const email = parsed.data.email.trim().toLowerCase();
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, active FROM users WHERE lower(email) = $1 LIMIT 1`,
      [email],
    );
    const user = result.rows[0];
    if (!user || !user.active) {
      return res.json({ ...generic, smtpPending: !smtpConfigured() });
    }

    const rawToken = newOpaqueToken();
    const expiresAt = passwordResetExpiresAt();
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, hashToken(rawToken), expiresAt.toISOString()],
    );

    const resetUrl = `${appPublicUrl().replace(/\/$/, "")}/reset-password/?token=${encodeURIComponent(rawToken)}`;
    const mail = await sendMail({
      to: user.email,
      subject: "Restablecer contraseña — NutriLab",
      text: [
        `Hola ${user.name},`,
        ``,
        `Usa este enlace para restablecer tu contraseña (válido unas horas):`,
        resetUrl,
        ``,
        `Si no pediste este cambio, ignora este correo.`,
      ].join("\n"),
    });

    const payload: Record<string, unknown> = {
      ...generic,
      mocked: mail.mocked,
      smtpPending: mail.mocked,
    };
    // Solo en desarrollo: facilita pruebas sin SMTP
    if (mail.mocked && process.env.NODE_ENV !== "production") {
      payload.devResetToken = rawToken;
      payload.devResetUrl = resetUrl;
    }
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "forgot_password_failed", message });
  }
});

authRouter.post("/v1/auth/reset-password", async (req, res) => {
  const parsed = resetBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      message: "Token y nueva contraseña (mín. 8) requeridos.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT id, user_id, expires_at, used_at
         FROM password_reset_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [hashToken(parsed.data.token)],
      );
      const row = found.rows[0];
      if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "invalid_reset_token",
          message: "El enlace no es válido o ya expiró.",
        });
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await client.query(
        `UPDATE users
         SET password_hash = $2, password_changed_at = now()
         WHERE id = $1 AND active = true`,
        [row.user_id, passwordHash],
      );
      await client.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");

      await revokeAllRefreshTokens(pool, String(row.user_id));

      return res.json({
        ok: true,
        message: "Contraseña restablecida. Ya puedes iniciar sesión.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "reset_password_failed", message });
  }
});

/**
 * Self-signup: pendiente de política comercial + SMTP (verificación de correo).
 * Endpoint reservado para no romper contratos futuros.
 */
authRouter.post("/v1/auth/signup", async (_req, res) => {
  return res.status(503).json({
    error: "signup_pending",
    smtpPending: true,
    message:
      "El registro libre aún no está habilitado. Enerxis te invita a tu laboratorio cuando el correo corporativo (SMTP) y el alta comercial estén listos.",
  });
});

authRouter.get("/v1/auth/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.user,
    smtpConfigured: smtpConfigured(),
  });
});
