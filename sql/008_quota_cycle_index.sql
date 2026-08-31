-- Cupo por ciclo: acelerar conteo billable en ventana temporal
CREATE INDEX IF NOT EXISTS idx_formula_versions_lab_billable_created
  ON formula_versions (lab_id, created_at)
  WHERE billable = true;

COMMENT ON INDEX idx_formula_versions_lab_billable_created IS
  'Cupo del ciclo: count billable WHERE created_at en [cycleStart, cycleEnd)';
