import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import {
  bumpChallengeAttempts,
  consumeChallenge,
  createChallenge,
  findOpenChallenge,
  mfaCodeHash,
} from "../lib/auth-challenges.js";
import { sendMfaCodeEmail, sendPasswordResetEmail } from "../lib/auth-emails.js";
import {
  hashToken,
  issueRefreshToken,
  newOpaqueToken,
  passwordResetExpiresAt,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../lib/auth-tokens.js";
import { appPublicUrl, smtpConfigured } from "../lib/mailer.js";
import { generateMfaCode, mfaCodeTtlMinutes } from "../lib/passwords.js";
import { requireAuth, signAccessToken } from "../middleware/auth.js";
import type { AuthUser, UserRole } from "../types/auth.js";

export const authRouter = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

const firstLoginBody = z.object({
  setupToken: z.string().min(20),
  newPassword: z.string().min(8).max(72),
});

const mfaVerifyBody = z.object({
  mfaToken: z.string().min(20),
  code: z.string().regex(/^\d{6}$/, "El código debe tener 6 dígitos"),
});

const mfaResendBody = z.object({
  mfaToken: z.string().min(20),
});

const MFA_MAX_ATTEMPTS = 5;

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
    `SELECT id, email, name, password_hash, role, lab_id, active,
            must_change_password, mfa_enabled, email_confirmed_at
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user || !user.active) return null;
  return user;
}

function authUserFromRow(row: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  lab_id: string | null;
}): AuthUser {
  return mapAuthUser(row);
}

async function issueFullSession(
  req: Parameters<typeof writeAudit>[0],
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    lab_id: string | null;
  },
) {
  const pool = getPool();
  const authUser = authUserFromRow(user);
  const token = signAccessToken(authUser);
  const { refreshToken } = await issueRefreshToken(pool, authUser.id, clientMeta(req));
  req.user = authUser;
  await writeAudit(req, {
    labId: authUser.labId,
    action: "login",
    detail: `Inicio de sesión · ${authUser.email} · ${authUser.role}`,
  });
  return {
    status: "ok" as const,
    token,
    accessToken: token,
    refreshToken,
    user: authUser,
  };
}

function mfaPublicFields(mailMocked: boolean, code: string) {
  const payload: Record<string, unknown> = {
    smtpPending: mailMocked,
    mocked: mailMocked,
    expiresInMinutes: mfaCodeTtlMinutes(),
  };
  if (mailMocked && process.env.NODE_ENV !== "production") {
    payload.devMfaCode = code;
  }
  return payload;
}

async function startMfaChallenge(
  req: Parameters<typeof writeAudit>[0],
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    lab_id: string | null;
  },
) {
  const pool = getPool();
  const authUser = mapAuthUser(user);
  req.user = authUser;
  const code = generateMfaCode();
  const { token } = await createChallenge(pool, {
    userId: user.id,
    kind: "mfa",
    ttlMinutes: mfaCodeTtlMinutes(),
    code,
  });
  const mail = await sendMfaCodeEmail({
    to: user.email,
    name: user.name,
    code,
    minutes: mfaCodeTtlMinutes(),
  });
  await writeAudit(req, {
    labId: user.lab_id,
    action: "login.mfa_sent",
    detail: `${user.email} · código enviado${mail.mocked ? " (SMTP mock)" : ""}`,
  });
  return {
    status: "mfa_required" as const,
    mfaToken: token,
    user: { email: user.email, name: user.name },
    message: mail.mocked
      ? "SMTP aún no está configurado. En desarrollo el código aparece en la respuesta y en el log del API."
      : `Enviamos un código de 6 dígitos a ${user.email}.`,
    ...mfaPublicFields(mail.mocked, code),
  };
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
      `SELECT id, email, name, password_hash, role, lab_id, active,
              COALESCE(must_change_password, false) AS must_change_password,
              COALESCE(mfa_enabled, false) AS mfa_enabled
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

    if (user.must_change_password) {
      const { token } = await createChallenge(pool, {
        userId: user.id,
        kind: "password_setup",
        ttlMinutes: Number(process.env.PASSWORD_RESET_HOURS || 2) * 60,
      });
      return res.json({
        status: "must_change_password",
        setupToken: token,
        user: { email: user.email, name: user.name },
        message:
          "Primer acceso: elige una contraseña nueva. Después se activará el código de 6 dígitos al correo.",
      });
    }

    if (user.mfa_enabled) {
      // Sin SMTP en producción no bloqueamos el acceso; el MFA se activa al configurar SMTP_*.
      if (!smtpConfigured() && process.env.NODE_ENV === "production") {
        return res.json(await issueFullSession(req, user));
      }
      return res.json(await startMfaChallenge(req, user));
    }

    return res.json(await issueFullSession(req, user));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "login_failed", message });
  }
});

authRouter.post("/v1/auth/complete-first-login", async (req, res) => {
  const parsed = firstLoginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      message: "La nueva contraseña debe tener al menos 8 caracteres.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const pool = getPool();
    const challenge = await findOpenChallenge(
      pool,
      parsed.data.setupToken,
      "password_setup",
    );
    if (!challenge) {
      return res.status(400).json({
        error: "invalid_setup_token",
        message: "El enlace de primer acceso expiró. Inicia sesión de nuevo con la contraseña temporal.",
      });
    }

    const user = await loadActiveUser(challenge.userId);
    if (!user || !user.must_change_password) {
      await consumeChallenge(pool, challenge.id);
      return res.status(400).json({
        error: "setup_not_required",
        message: "Esta cuenta ya completó el primer acceso.",
      });
    }

    const same = await bcrypt.compare(parsed.data.newPassword, user.password_hash);
    if (same) {
      return res.status(400).json({
        error: "same_password",
        message: "La nueva contraseña debe ser distinta a la temporal.",
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    const enableMfa = user.role === "lab_admin";
    await pool.query(
      `UPDATE users
       SET password_hash = $2,
           must_change_password = false,
           email_confirmed_at = now(),
           mfa_enabled = $3,
           password_changed_at = now()
       WHERE id = $1`,
      [user.id, passwordHash, enableMfa],
    );
    await consumeChallenge(pool, challenge.id);
    await revokeAllRefreshTokens(pool, user.id);

    req.user = mapAuthUser(user);
    await writeAudit(req, {
      labId: user.lab_id,
      action: "password.first_change",
      detail: enableMfa
        ? `${user.email} · correo confirmado · MFA activado`
        : `${user.email} · correo confirmado`,
    });

    return res.json({
      ok: true,
      mfaEnabled: enableMfa,
      message: enableMfa
        ? "Contraseña actualizada. Vuelve a iniciar sesión: te enviaremos un código de 6 dígitos a tu correo."
        : "Contraseña actualizada. Ya puedes iniciar sesión.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "first_login_failed", message });
  }
});

authRouter.post("/v1/auth/mfa/verify", async (req, res) => {
  const parsed = mfaVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_body",
      message: "Ingresa el código de 6 dígitos.",
      details: parsed.error.flatten(),
    });
  }

  try {
    const pool = getPool();
    const challenge = await findOpenChallenge(pool, parsed.data.mfaToken, "mfa");
    if (!challenge) {
      return res.status(400).json({
        error: "invalid_mfa_token",
        message: "El código expiró. Inicia sesión de nuevo.",
      });
    }

    if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
      await consumeChallenge(pool, challenge.id);
      return res.status(401).json({
        error: "mfa_locked",
        message: "Demasiados intentos. Inicia sesión de nuevo para recibir otro código.",
      });
    }

    if (!challenge.codeHash || challenge.codeHash !== mfaCodeHash(parsed.data.code)) {
      const attempts = await bumpChallengeAttempts(pool, challenge.id);
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await consumeChallenge(pool, challenge.id);
        return res.status(401).json({
          error: "mfa_locked",
          message: "Demasiados intentos. Inicia sesión de nuevo para recibir otro código.",
        });
      }
      return res.status(401).json({
        error: "invalid_mfa_code",
        message: "Código incorrecto.",
        attemptsLeft: MFA_MAX_ATTEMPTS - attempts,
      });
    }

    const user = await loadActiveUser(challenge.userId);
    if (!user) {
      await consumeChallenge(pool, challenge.id);
      return res.status(401).json({ error: "invalid_mfa_token", message: "Usuario inactivo" });
    }

    await consumeChallenge(pool, challenge.id);
    return res.json(await issueFullSession(req, user));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "mfa_verify_failed", message });
  }
});

authRouter.post("/v1/auth/mfa/resend", async (req, res) => {
  const parsed = mfaResendBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  try {
    const pool = getPool();
    const challenge = await findOpenChallenge(pool, parsed.data.mfaToken, "mfa");
    if (!challenge) {
      return res.status(400).json({
        error: "invalid_mfa_token",
        message: "La sesión de verificación expiró. Inicia sesión de nuevo.",
      });
    }

    const ageMs = Date.now() - (challenge.expiresAt.getTime() - mfaCodeTtlMinutes() * 60_000);
    if (ageMs < 60_000) {
      return res.status(429).json({
        error: "mfa_resend_wait",
        message: "Espera unos segundos antes de pedir otro código.",
      });
    }

    const user = await loadActiveUser(challenge.userId);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    return res.json(await startMfaChallenge(req, user));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "mfa_resend_failed", message });
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
    if (user.must_change_password) {
      await revokeAllRefreshTokens(pool, rotated.userId);
      return res.status(401).json({
        error: "must_change_password",
        message: "Debes cambiar la contraseña temporal antes de continuar.",
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
    const mail = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
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
