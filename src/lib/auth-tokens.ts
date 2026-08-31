import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { env } from "../config/env.js";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function refreshExpiresAt(): Date {
  const days = Number(process.env.REFRESH_TOKEN_DAYS || env.refreshTokenDays);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(days) && days > 0 ? days : 30));
  return d;
}

export function passwordResetExpiresAt(): Date {
  const hours = Number(process.env.PASSWORD_RESET_HOURS || 2);
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + (Number.isFinite(hours) && hours > 0 ? hours : 2));
  return d;
}

export async function issueRefreshToken(
  pool: Pool,
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<{ refreshToken: string; expiresAt: Date }> {
  const refreshToken = newOpaqueToken();
  const expiresAt = refreshExpiresAt();
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(refreshToken),
      expiresAt.toISOString(),
      meta?.userAgent?.slice(0, 400) ?? null,
      meta?.ip?.slice(0, 80) ?? null,
    ],
  );
  return { refreshToken, expiresAt };
}

export async function revokeRefreshToken(pool: Pool, rawToken: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE token_hash = $1
       AND revoked_at IS NULL
     RETURNING id`,
    [hashToken(rawToken)],
  );
  return Boolean(result.rows[0]);
}

export async function revokeAllRefreshTokens(pool: Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function rotateRefreshToken(
  pool: Pool,
  rawToken: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<{ userId: string; refreshToken: string; expiresAt: Date } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [hashToken(rawToken)],
    );
    const row = existing.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
      row.id,
    ]);

    const refreshToken = newOpaqueToken();
    const expiresAt = refreshExpiresAt();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        row.user_id,
        hashToken(refreshToken),
        expiresAt.toISOString(),
        meta?.userAgent?.slice(0, 400) ?? null,
        meta?.ip?.slice(0, 80) ?? null,
      ],
    );
    await client.query("COMMIT");
    return { userId: String(row.user_id), refreshToken, expiresAt };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
