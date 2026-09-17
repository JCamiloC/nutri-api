-- Marca de plataforma (NutriLab / Enerxis). La usa el chrome del producto y las plantillas de correo.
-- Un solo registro id = 'default'. El superadmin lo edita como un personalizador.

CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  product_name TEXT NOT NULL DEFAULT 'NutriLab',
  company_name TEXT NOT NULL DEFAULT 'Enerxis',
  tagline TEXT NOT NULL DEFAULT 'Tablas nutricionales listas para etiquetar',
  support_email TEXT,
  logo_ext TEXT,
  ink_color TEXT NOT NULL DEFAULT '#13344c',
  accent_color TEXT NOT NULL DEFAULT '#1f88a4',
  page_color TEXT NOT NULL DEFAULT '#eef4f9',
  email_from_name TEXT,
  email_footer TEXT,
  welcome_intro TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE platform_settings IS
  'Identidad global: nombre, logo y textos de correo. Si se cambia, los próximos envíos usan la marca nueva.';
