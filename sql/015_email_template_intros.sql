-- Textos editables por tipo de correo (personalizador superadmin).

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS mfa_intro TEXT,
  ADD COLUMN IF NOT EXISTS invite_intro TEXT,
  ADD COLUMN IF NOT EXISTS reset_intro TEXT;

COMMENT ON COLUMN platform_settings.mfa_intro IS 'Párrafo opcional antes del código MFA';
COMMENT ON COLUMN platform_settings.invite_intro IS 'Párrafo opcional en invitación a usuario del lab';
COMMENT ON COLUMN platform_settings.reset_intro IS 'Párrafo opcional en restablecer contraseña';
