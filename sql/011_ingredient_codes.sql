-- Código incremental de inventario propio (IN-00001). Sin costo en UI.
ALTER TABLE labs
  ADD COLUMN IF NOT EXISTS ingredient_code_seq INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  lab RECORD;
  max_n INTEGER;
BEGIN
  FOR lab IN SELECT id FROM labs LOOP
    UPDATE ingredients i
    SET referencia = 'IN-' || LPAD(sub.n::text, 5, '0')
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
      FROM ingredients
      WHERE lab_id = lab.id
        AND source = 'BD'
        AND COALESCE(is_base, false) = false
        AND (referencia IS NULL OR btrim(referencia) = '')
    ) sub
    WHERE i.id = sub.id;

    SELECT COALESCE(MAX(
      CASE
        WHEN referencia ~ '^IN-[0-9]+$'
          THEN CAST(SUBSTRING(referencia FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0)
    INTO max_n
    FROM ingredients
    WHERE lab_id = lab.id
      AND source = 'BD'
      AND COALESCE(is_base, false) = false;

    UPDATE labs
    SET ingredient_code_seq = GREATEST(ingredient_code_seq, max_n)
    WHERE id = lab.id;
  END LOOP;
END $$;
