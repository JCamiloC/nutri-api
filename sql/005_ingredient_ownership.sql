-- Ownership / catálogo global de ingredientes (fase 1)
-- - Base Enerxis global (is_base): ver + usar, no editar
-- - BD de clientes: visibles globalmente; editar solo el creador
-- - ICBF/USDA: siguen siendo copias por lab (attach)

ALTER TABLE ingredients
  ALTER COLUMN lab_id DROP NOT NULL;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS is_base BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS copied_from_id UUID REFERENCES ingredients(id) ON DELETE SET NULL;

-- Base global: lab_id NULL + is_base
COMMENT ON COLUMN ingredients.is_base IS 'Base Enerxis global: solo lectura para todos los clientes';
COMMENT ON COLUMN ingredients.created_by_user_id IS 'Usuario cliente dueño (edición solo suya)';
COMMENT ON COLUMN ingredients.copied_from_id IS 'Origen si se duplicó desde base/otro';

-- Backfill: dueño = primer admin activo del lab (BD no-base)
UPDATE ingredients i
SET created_by_user_id = u.id
FROM (
  SELECT DISTINCT ON (lab_id) id, lab_id
  FROM users
  WHERE role IN ('lab_admin', 'superadmin') AND active = true AND lab_id IS NOT NULL
  ORDER BY lab_id, created_at ASC
) u
WHERE i.lab_id = u.lab_id
  AND i.source = 'BD'
  AND i.is_base = false
  AND i.created_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_is_base ON ingredients (is_base) WHERE is_base = true;
CREATE INDEX IF NOT EXISTS idx_ingredients_created_by ON ingredients (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_source_global ON ingredients (source);

-- Una sola base por referencia Enerxis (si tiene código)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredients_base_ref
  ON ingredients (referencia)
  WHERE is_base = true AND referencia IS NOT NULL AND btrim(referencia) <> '';
