-- Inventario de productos: edulcorante, aditivo y función tecnológica
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS contains_sweetener BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS is_additive BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS technological_function TEXT;

COMMENT ON COLUMN ingredients.contains_sweetener IS 'Declaración: el producto contiene edulcorante(s)';
COMMENT ON COLUMN ingredients.is_additive IS 'Es aditivo alimentario';
COMMENT ON COLUMN ingredients.technological_function IS 'Función tecnológica (rotulado aditivos, Res. 1506 / Codex)';
