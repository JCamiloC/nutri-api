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
npm run build               # best-effort mientras tsc falle en upstream
pm2 restart nutri-api       # solo si migrate (y el resto del script) OK
```

Reglas:

- **Migrate antes del restart.**
- Si `db:migrate` falla → `set -e` aborta el script → **no se reinicia** la app.
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

**No** correr `db:seed` / `db:seed-base` en producción salvo decisión comercial explícita (base Enerxis).

Front (nutri-saas): deploy FTP/Actions **no** migra BD; solo apunta a `NEXT_PUBLIC_API_URL`.

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
