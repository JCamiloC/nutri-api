-- Modo de uso default + perfiles fabricante (por / para) por laboratorio

ALTER TABLE labs
  ADD COLUMN IF NOT EXISTS usage_mode_default TEXT;

COMMENT ON COLUMN labs.usage_mode_default IS 'Modo de uso sugerido en fórmulas nuevas (rotulado)';

CREATE TABLE IF NOT EXISTS lab_manufacturer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  manufactured_by TEXT NOT NULL,
  manufactured_for TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lab_manufacturer_profiles_lab_id_idx
  ON lab_manufacturer_profiles (lab_id);

ALTER TABLE formulas
  ADD COLUMN IF NOT EXISTS manufacturer_profile_id UUID
  REFERENCES lab_manufacturer_profiles(id) ON DELETE SET NULL;

-- Migrar defaults legacy a un perfil «Principal»
INSERT INTO lab_manufacturer_profiles (lab_id, label, manufactured_by, manufactured_for, is_default, sort_order)
SELECT
  l.id,
  'Principal',
  COALESCE(NULLIF(trim(l.manufactured_by_default), ''), '—'),
  COALESCE(NULLIF(trim(l.manufactured_for_default), ''), '—'),
  true,
  0
FROM labs l
WHERE NOT EXISTS (
  SELECT 1 FROM lab_manufacturer_profiles p WHERE p.lab_id = l.id
)
AND (
  (l.manufactured_by_default IS NOT NULL AND trim(l.manufactured_by_default) <> '')
  OR (l.manufactured_for_default IS NOT NULL AND trim(l.manufactured_for_default) <> '')
);
