-- Detalle cuando función tecnológica = «Otros (especificar en observaciones)».
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS technological_function_notes TEXT;

COMMENT ON COLUMN ingredients.technological_function_notes IS
  'Especificación de función cuando technological_function es Otros (rotulado aditivos)';
