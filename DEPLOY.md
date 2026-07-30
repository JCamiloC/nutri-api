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

## Deploy manual (sin webhook)

```bash
bash /opt/nutri-deploy/deploy.sh
```
