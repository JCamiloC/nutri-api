-- Aclara ownership de la base global Enerxis
COMMENT ON COLUMN ingredients.is_base IS
  'Base global Enerxis: visible para todos; editable solo por superadmin; clientes duplican';
