-- Campos de rotulado INVIMA / printTabla (modo conservación)
ALTER TABLE formulas
  ADD COLUMN IF NOT EXISTS storage_mode TEXT;

COMMENT ON COLUMN formulas.storage_mode IS 'Modo de conservación del producto (rotulado)';
COMMENT ON COLUMN formulas.rsa IS 'RSA/NSA del producto';
COMMENT ON COLUMN formulas.flavor IS 'Sabor';
COMMENT ON COLUMN formulas.usage_mode IS 'Modo de uso';
COMMENT ON COLUMN formulas.sweetener IS 'Flag edulcorante: 1/true = contiene';
COMMENT ON COLUMN formulas.meta IS 'JSON: sealOverrides {azucar,sodio,sat,trans,edulcorante}';
