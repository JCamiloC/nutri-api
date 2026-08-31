# Deploy (VPS / producción)

## Variables

El migrator y la API leen `DATABASE_URL` desde `.env` en la raíz del repo (no versionado).

En este VPS de prueba:

- App: `/var/www/html/nutri-api`
- `.env` con `DATABASE_URL` apuntando a Postgres local (`nutri_lab`)
- Proceso: PM2 `nutri-api` (runtime actual: `tsx src/index.ts`)
- Webhook: PM2 `nutri-webhook` → `/opt/nutri-deploy/webhook.js`
- Script de deploy: `/opt/nutri-deploy/deploy.sh`

Confirmar URL de BD (sin imprimir password en logs públicos):

```bash
cd /var/www/html/nutri-api
grep '^DATABASE_URL=' .env
# debe ser el Postgres real del VPS, no Docker de desarrollo
```

## Flujo del webhook (push a `main`)

1. GitHub POST → `https://nutriapi.fidare.com/github-webhook`
2. Firma `X-Hub-Signature-256` válida + `ref = refs/heads/main`
3. Ejecuta `/opt/nutri-deploy/deploy.sh`:

```text
git fetch + reset --hard origin/main
npm ci
npm run db:migrate          # ANTES de reiniciar; usa .env / DATABASE_URL
npm run db:import-catalog   # ICBF 100% + base Enerxis (Excel en data/); idempotente
npm run build               # best-effort mientras tsc falle en upstream
pm2 restart nutri-api       # solo si migrate (y el resto del script) OK
```

Reglas:

- **Migrate antes del restart.**
- Luego **`db:import-catalog`** (Excel versionados en `data/`):
  - `BD_ICBF.xlsx` → `icbf_foods` (TRUNCATE + carga completa; vacíos → 0)
  - `BASE_ENERXIS_INGREDIENTES.xlsx` → `ingredients` con `is_base=true` (upsert; vacíos → 0)
  - Skip parcial: `SKIP_ICBF_IMPORT=1` / `SKIP_BASE_IMPORT=1`
- Si `db:migrate` o `db:import-catalog` falla → `set -e` aborta → **no se reinicia** la app.
- **No** se ejecutan `db:seed` / `db:seed-users` en producción.
- Logs: `/var/log/nutri-deploy.log`

## Migraciones (`schema_migrations`)

`npm run db:migrate` (`tsx src/db/migrate.ts`):

1. Crea `schema_migrations` si no existe.
2. Lista `sql/*.sql` ordenados alfabéticamente.
3. **Bootstrap (BD ya poblada):** si no hay filas en `schema_migrations` pero existe la tabla `labs`, registra los `.sql` actuales como aplicados **sin re-ejecutarlos**.
4. Aplica solo archivos nuevos, cada uno en una transacción; si falla → rollback, no marca el id, exit ≠ 0.

### Probar migrate

Local (Docker / `.env` local):

```bash
npm run db:migrate
# segunda vez: todos en skip
```

Producción (en el VPS, con el `.env` de prod):

```bash
cd /var/www/html/nutri-api
npm run db:migrate
```

Ver tracking:

```bash
psql "$DATABASE_URL" -c 'SELECT * FROM schema_migrations ORDER BY applied_at'
```

## Migraciones pendientes / checklist prod

Al hacer push a `main` del repo API, el webhook debe aplicar automáticamente:

- `005_ingredient_ownership.sql` — ownership global de ingredientes
- `006_formula_versions.sql` — versionado comercial + backfill de exportadas
- `007_label_fields.sql` — campos de rotulado / toggles
- `008_quota_cycle_index.sql` — índice cupo billable por ciclo (`created_at`)

**Cupo:** `getLabCapacity` cuenta solo versiones `billable` del ciclo
`[renews_at − 1 mes, renews_at)`. Si `renews_at` ya pasó, avanza la fecha,
pone `tables_extra = 0` y el uso del ciclo anterior deja de contar.

Verificar post-deploy:

```bash
psql "$DATABASE_URL" -c "SELECT id, applied_at FROM schema_migrations ORDER BY id"
psql "$DATABASE_URL" -c "\d formula_versions"
```

**No** correr `db:seed` / `db:seed-users` en producción.
La base Enerxis y el ICBF van con `npm run db:import-catalog` (ver arriba).
`db:seed-base` es alias local de `db:import-base-excel`.

**Permisos base:** clientes ven/usan y pueden **duplicar**; solo **superadmin** (Enerxis) edita `is_base`.

Front (nutri-saas): deploy FTP/Actions **no** migra BD; solo apunta a `NEXT_PUBLIC_API_URL`.

## Auth / sesiones

- Access JWT corto (`JWT_EXPIRES_IN`, default `1h`) + **refresh token** en BD (`010_auth_sessions.sql`).
- Login devuelve `token` + `refreshToken`. Logout llama `POST /v1/auth/logout` (revoca).
- Cambiar contraseña: `POST /v1/auth/change-password` (revoca otras sesiones).
- Forgot/reset: endpoints listos; **correo real requiere SMTP**. Sin SMTP → mock + en dev `devResetUrl`.
- Invitación: intenta email; sin SMTP sigue devolviendo `temporaryPassword` para copiar.
- Self-signup: `POST /v1/auth/signup` → `503 signup_pending` hasta política + SMTP.

## Mesa de ayuda (tickets por correo)

`POST /v1/support/tickets`:

- **Sin SMTP** (estado actual en prod): modo **mock** — responde `ok`, guarda en auditoría (`support.ticket` con prefijo `[mock]`) y loguea en el servidor. No falla.
- **Con SMTP**: envía correo real a `SUPPORT_EMAIL`.

```bash
SUPPORT_EMAIL=soporte@enerxis.com
SMTP_HOST=smtp.ejemplo.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="NutriLab <noreply@enerxis.com>"
# SMTP_SECURE=true   # solo si el puerto es 465
```

## Deploy manual (sin webhook)

```bash
bash /opt/nutri-deploy/deploy.sh
```
