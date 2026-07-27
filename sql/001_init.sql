-- NutriLab schema v1 — alineado a Enerxis (recetas / inventario / ICBF)
-- + multi-tenant labs para el SaaS.
-- Aplicar: npm run db:migrate   (o psql $DATABASE_URL -f sql/001_init.sql)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy (SaaS nuevo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activo'
    CHECK (status IN ('activo', 'pendiente', 'suspendido')),
  plan_id TEXT,
  tables_extra INT NOT NULL DEFAULT 0,
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID REFERENCES labs(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'lab_admin'
    CHECK (role IN ('superadmin', 'lab_admin', 'lab_reader')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catálogo ICBF (equivalente icbf_alimentos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS icbf_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  parte_analizada TEXT,
  fuente TEXT,
  grasas NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_saturada NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_mono NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_poli NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_trans NUMERIC(14, 6) NOT NULL DEFAULT 0,
  colesterol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  sodio NUMERIC(14, 6) NOT NULL DEFAULT 0,
  potasio NUMERIC(14, 6) NOT NULL DEFAULT 0,
  carbohidratos NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra_sol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra_insol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  polialcoholes NUMERIC(14, 6) NOT NULL DEFAULT 0,
  azucar NUMERIC(14, 6) NOT NULL DEFAULT 0,
  azucar_add NUMERIC(14, 6) NOT NULL DEFAULT 0,
  proteina NUMERIC(14, 6) NOT NULL DEFAULT 0,
  energia_kcal NUMERIC(14, 6) NOT NULL DEFAULT 0,
  humedad NUMERIC(14, 6),
  vitaminas JSONB NOT NULL DEFAULT '[]'::jsonb,
  aminoacidos JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icbf_foods_nombre ON icbf_foods (nombre);

-- ---------------------------------------------------------------------------
-- Inventario del laboratorio (equivalente inventario)
-- origen: BD editable | API/ICBF copias o referencias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ICBF', 'BD', 'API')),
  referencia TEXT,
  nombre TEXT NOT NULL,
  parte_analizada TEXT,
  cantidad NUMERIC(14, 6) NOT NULL DEFAULT 100,
  unidad_medida TEXT NOT NULL DEFAULT 'g',
  costo NUMERIC(14, 4) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'SOLIDO',
  proveedor TEXT,
  tipo TEXT NOT NULL DEFAULT 'ACTIVO',
  read_only BOOLEAN NOT NULL DEFAULT false,
  grasas NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_saturada NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_mono NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_poli NUMERIC(14, 6) NOT NULL DEFAULT 0,
  grasa_trans NUMERIC(14, 6) NOT NULL DEFAULT 0,
  colesterol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  sodio NUMERIC(14, 6) NOT NULL DEFAULT 0,
  potasio NUMERIC(14, 6) NOT NULL DEFAULT 0,
  carbohidratos NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra_sol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  fibra_insol NUMERIC(14, 6) NOT NULL DEFAULT 0,
  polialcoholes NUMERIC(14, 6) NOT NULL DEFAULT 0,
  azucar NUMERIC(14, 6) NOT NULL DEFAULT 0,
  azucar_add NUMERIC(14, 6) NOT NULL DEFAULT 0,
  proteina NUMERIC(14, 6) NOT NULL DEFAULT 0,
  energia_kcal NUMERIC(14, 6) NOT NULL DEFAULT 0,
  humedad NUMERIC(14, 6),
  vitaminas JSONB NOT NULL DEFAULT '[]'::jsonb,
  alergenos JSONB NOT NULL DEFAULT '{}'::jsonb,
  aminoacidos JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_lab ON ingredients (lab_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_nombre ON ingredients (nombre);
CREATE INDEX IF NOT EXISTS idx_ingredients_referencia ON ingredients (lab_id, referencia);
CREATE INDEX IF NOT EXISTS idx_ingredients_source ON ingredients (lab_id, source);

-- ---------------------------------------------------------------------------
-- Fórmulas / tablas nutricionales (equivalente recetas + datosRecetas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  product_name TEXT,
  brand TEXT,
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador', 'lista', 'exportada')),
  -- Enerxis: peso neto del paquete / base de cálculo (g o mL según tipo)
  package_weight NUMERIC(14, 6) NOT NULL DEFAULT 100,
  weight_unit TEXT NOT NULL DEFAULT 'g',
  servings NUMERIC(14, 6) NOT NULL DEFAULT 1,
  serving_size NUMERIC(14, 6) NOT NULL DEFAULT 1,
  reconstituted_serving NUMERIC(14, 6) NOT NULL DEFAULT 0,
  water_per_serving NUMERIC(14, 6) NOT NULL DEFAULT 0,
  formula_type TEXT NOT NULL DEFAULT 'Solido'
    CHECK (formula_type IN ('Solido', 'Liquido', 'Reconstituida')),
  ingredient_count INT NOT NULL DEFAULT 0,
  -- Campos de rotulado / impresión
  show_logo BOOLEAN NOT NULL DEFAULT true,
  sweetener TEXT,
  rsa TEXT,
  flavor TEXT,
  usage_mode TEXT,
  manufactured_by TEXT,
  manufactured_for TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulas_lab ON formulas (lab_id);
CREATE INDEX IF NOT EXISTS idx_formulas_title ON formulas (lab_id, title);

CREATE TABLE IF NOT EXISTS formula_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('ICBF', 'BD', 'API')),
  -- id/código según fuente: UUID inventario, codigo ICBF, fdcId USDA
  external_ref TEXT,
  name TEXT NOT NULL,
  percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formula_lines_formula ON formula_lines (formula_id);

-- ---------------------------------------------------------------------------
-- Auditoría mínima (SaaS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id UUID REFERENCES labs(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_lab ON audit_events (lab_id, created_at DESC);

-- Lab demo para desarrollo local
INSERT INTO labs (id, name, status, plan_id, city)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Laboratorio Andes Formulación',
  'activo',
  'pro',
  'Medellín'
)
ON CONFLICT (id) DO NOTHING;
