-- Planes comerciales + packs extra + renovación de lab

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly INT NOT NULL DEFAULT 0,
  tables_included INT NOT NULL,
  admin_seats INT NOT NULL DEFAULT 1,
  readers_unlimited BOOLEAN NOT NULL DEFAULT true,
  pdf_export BOOLEAN NOT NULL DEFAULT true,
  label_preview BOOLEAN NOT NULL DEFAULT true,
  audit_log BOOLEAN NOT NULL DEFAULT true,
  highlight BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extra_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tables_count INT NOT NULL,
  price INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);

ALTER TABLE labs
  ADD COLUMN IF NOT EXISTS renews_at DATE;

INSERT INTO plans (
  id, name, price_monthly, tables_included, admin_seats,
  readers_unlimited, pdf_export, label_preview, audit_log, highlight, description
) VALUES
  (
    'starter', 'Starter', 189000, 5, 1,
    true, true, true, true, false,
    'Ideal para laboratorios que inician digitalización de etiquetas.'
  ),
  (
    'pro', 'Pro', 449000, 20, 3,
    true, true, true, true, true,
    'El equilibrio para equipos que producen fórmulas cada semana.'
  ),
  (
    'business', 'Business', 890000, 50, 5,
    true, true, true, true, false,
    'Para operaciones con alto volumen y varios administradores.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO extra_packs (id, name, tables_count, price, description) VALUES
  ('x5', 'Pack +5', 5, 99000, 'Cinco tablas adicionales para el ciclo actual.'),
  ('x10', 'Pack +10', 10, 179000, 'Diez tablas adicionales para el ciclo actual.'),
  ('x20', 'Pack +20', 20, 299000, 'Veinte tablas adicionales para el ciclo actual.')
ON CONFLICT (id) DO NOTHING;

UPDATE labs
SET plan_id = COALESCE(plan_id, 'pro'),
    renews_at = COALESCE(renews_at, (CURRENT_DATE + INTERVAL '30 days')::date)
WHERE id = '00000000-0000-4000-8000-000000000001';
