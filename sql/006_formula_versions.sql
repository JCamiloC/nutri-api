-- Versionado comercial de tablas nutricionales
-- Cada emisión con contenido nuevo = versión billable (cupo).
-- Reimpresión del mismo contenido = misma versión, sin cupo.

CREATE TABLE IF NOT EXISTS formula_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  version_seq INT NOT NULL,
  billable BOOLEAN NOT NULL DEFAULT true,
  content_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (formula_id, version_seq),
  UNIQUE (formula_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_formula_versions_formula
  ON formula_versions (formula_id, version_seq DESC);

CREATE INDEX IF NOT EXISTS idx_formula_versions_lab_billable
  ON formula_versions (lab_id)
  WHERE billable = true;

COMMENT ON TABLE formula_versions IS
  'Snapshots inmutables de tablas emitidas. billable=true cobra 1 cupo.';

-- Backfill: fórmulas ya exportadas sin historial → v1.0 billable (protege cupo histórico)
INSERT INTO formula_versions (
  formula_id, lab_id, version_label, version_seq, billable, content_hash, snapshot
)
SELECT
  f.id,
  f.lab_id,
  '1.0',
  1,
  true,
  'migrated-' || f.id::text,
  jsonb_build_object(
    'migrated', true,
    'formula', jsonb_build_object(
      'title', f.title,
      'productName', f.product_name,
      'brand', f.brand,
      'formulaType', f.formula_type,
      'packageWeight', f.package_weight,
      'servings', f.servings,
      'servingSize', f.serving_size,
      'status', f.status
    ),
    'note', 'Versión creada en migración; reimprimir tras editar generará v1.1 con snapshot completo'
  )
FROM formulas f
WHERE f.status = 'exportada'
  AND NOT EXISTS (
    SELECT 1 FROM formula_versions v WHERE v.formula_id = f.id
  );
