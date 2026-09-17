import type { Pool } from "pg";
import { hashToken, newOpaqueToken } from "./auth-tokens.js";

export type ChallengeKind = "password_setup" | "mfa";

export type AuthChallenge = {
  id: string;
  userId: string;
  kind: ChallengeKind;
  codeHash: string | null;
  expiresAt: Date;
  attempts: number;
};

export async function invalidateOpenChallenges(
  pool: Pool,
  userId: string,
  kind: ChallengeKind,
): Promise<void> {
  await pool.query(
    `UPDATE auth_challenges
     SET consumed_at = now()
     WHERE user_id = $1
       AND kind = $2
       AND consumed_at IS NULL`,
    [userId, kind],
  );
}

export async function createChallenge(
  pool: Pool,
  input: {
    userId: string;
    kind: ChallengeKind;
    ttlMinutes: number;
    code?: string;
  },
): Promise<{ token: string; challenge: AuthChallenge }> {
  await invalidateOpenChallenges(pool, input.userId, input.kind);
  const token = newOpaqueToken();
  const expiresAt = new Date();
  expiresAt.setUTCMinutes(expiresAt.getUTCMinutes() + input.ttlMinutes);
  const codeHash = input.code
    ? hashToken(`${input.kind}:${input.code}`)
    : null;
  const result = await pool.query(
    `INSERT INTO auth_challenges (user_id, kind, token_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, kind, code_hash, expires_at, attempts`,
    [input.userId, input.kind, hashToken(token), codeHash, expiresAt.toISOString()],
  );
  const row = result.rows[0];
  return {
    token,
    challenge: {
      id: String(row.id),
      userId: String(row.user_id),
      kind: row.kind,
      codeHash: row.code_hash ?? null,
      expiresAt: new Date(row.expires_at),
      attempts: Number(row.attempts ?? 0),
    },
  };
}

export async function findOpenChallenge(
  pool: Pool,
  rawToken: string,
  kind: ChallengeKind,
): Promise<AuthChallenge | null> {
  const result = await pool.query(
    `SELECT id, user_id, kind, code_hash, expires_at, attempts, consumed_at
     FROM auth_challenges
     WHERE token_hash = $1 AND kind = $2
     LIMIT 1`,
    [hashToken(rawToken), kind],
  );
  const row = result.rows[0];
  if (!row || row.consumed_at) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind,
    codeHash: row.code_hash ?? null,
    expiresAt: new Date(row.expires_at),
    attempts: Number(row.attempts ?? 0),
  };
}

export async function consumeChallenge(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `UPDATE auth_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [id],
  );
}

export async function bumpChallengeAttempts(
  pool: Pool,
  id: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE auth_challenges
     SET attempts = attempts + 1
     WHERE id = $1
     RETURNING attempts`,
    [id],
  );
  return Number(result.rows[0]?.attempts ?? 0);
}

export function mfaCodeHash(code: string): string {
  return hashToken(`mfa:${code.trim()}`);
}
