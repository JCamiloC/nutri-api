-- Lab branding (logo por laboratorio) + watermark por fórmula
-- Idempotente: seguro re-aplicar.

ALTER TABLE labs
  ADD COLUMN IF NOT EXISTS logo_ext TEXT,
  ADD COLUMN IF NOT EXISTS watermark_default BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manufactured_by_default TEXT,
  ADD COLUMN IF NOT EXISTS manufactured_for_default TEXT;

ALTER TABLE formulas
  ADD COLUMN IF NOT EXISTS show_watermark BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN labs.logo_ext IS 'Extensión del archivo de logo (png|jpg|jpeg|webp|svg); archivo en uploads/labs/{id}/logo.{ext}';
COMMENT ON COLUMN labs.watermark_default IS 'Default de marca de agua al crear fórmulas';
COMMENT ON COLUMN formulas.show_watermark IS 'Mostrar marca de agua del lab en rotulado/impresión';
