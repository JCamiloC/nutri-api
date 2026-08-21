-- Evita duplicar la misma copia ICBF/USDA en el inventario del lab.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredients_lab_source_ref
  ON ingredients (lab_id, source, referencia)
  WHERE referencia IS NOT NULL AND btrim(referencia) <> '';
