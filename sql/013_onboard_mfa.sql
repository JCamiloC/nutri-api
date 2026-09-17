-- Alta comercial: primer acceso con contraseña temporal + MFA por correo (6 dígitos).
-- SMTP se configura con SMTP_* ; sin esas vars el mailer sigue en mock.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

-- Usuarios ya existentes: no forzar cambio ni MFA.
UPDATE users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL
  AND must_change_password = false;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('password_setup', 'mfa')),
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_kind
  ON auth_challenges (user_id, kind)
  WHERE consumed_at IS NULL;

COMMENT ON COLUMN users.must_change_password IS
  'true tras alta comercial: el primer login no emite sesión hasta cambiar la temporal';
COMMENT ON COLUMN users.email_confirmed_at IS
  'Se marca al completar el primer cambio de contraseña (correo del admin cliente)';
COMMENT ON COLUMN users.mfa_enabled IS
  'Tras confirmar el primer acceso, cada login pide código de 6 dígitos al correo';
COMMENT ON TABLE auth_challenges IS
  'Tokens opacos de primer acceso (password_setup) y MFA (código hasheado)';
