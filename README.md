# nutri-api

API Node (Express + TypeScript) para **Enerxis NutriLab**.  
Repo: [JCamiloC/nutri-api](https://github.com/JCamiloC/nutri-api).

## Requisitos

- Node.js 20+
- Docker Desktop (para Postgres local en cualquier PC)

## Arranque en un PC nuevo (clonar y levantar)

```bash
git clone https://github.com/JCamiloC/nutri-api.git
cd nutri-api
cp .env.example .env
npm ci
npm run db:setup    # levanta Postgres en Docker + aplica schema
npm run dev         # http://localhost:4000
```

Verifica:

```bash
curl http://127.0.0.1:4000/health
npm run test:engine
```

Credenciales locales por defecto (`.env.example`):

```text
postgresql://nutri:nutri@127.0.0.1:5432/nutri_lab
```

### Comandos Docker útiles

| Script | Qué hace |
|--------|----------|
| `npm run db:up` | Solo levanta el contenedor |
| `npm run db:setup` | Up + espera + migrate |
| `npm run db:migrate` | Aplica `sql/*.sql` nuevos vía `schema_migrations` |
| `npm run db:down` | Para el contenedor (conserva datos) |
| `npm run db:reset` | Borra volumen y recrea BD limpia |
| `npm run db:logs` | Logs de Postgres |

## VPS / producción

Usa Postgres del servidor (sin Docker si prefieres). En `.env`:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/nutri_lab
```

Luego: `npm ci && npm run db:migrate && npm run build && npm start`

Detalle del webhook, orden de deploy y bootstrap de migraciones: ver [DEPLOY.md](./DEPLOY.md).

### Migraciones

Los archivos en `sql/` se aplican **una sola vez**, registrados en `schema_migrations`.

- Primera corrida en BD vacía: aplica todos los `.sql` en orden.
- Primera corrida en BD ya poblada (p. ej. ya existía `labs`): **bootstrap** — marca los SQL actuales como applied sin re-ejecutarlos; solo correrán archivos nuevos después.
- Fallo en un archivo: rollback de esa migración, no se marca, exit code ≠ 0.

```bash
npm run db:migrate
```

No correr `db:seed` automáticamente en producción.

## Endpoints

| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/health` | Estado API + DB |
| POST | `/v1/recalculate` | Motor nutricional |
| GET/POST | `/v1/formulas` | Listar / crear fórmulas |
| GET/PATCH/DELETE | `/v1/formulas/:id` | Detalle / actualizar / borrar |
| GET/POST | `/v1/ingredients` | Inventario del lab |
| GET | `/v1/ingredients/:id` | Detalle ingrediente |

Header opcional: `X-Lab-Id` (default: lab demo).

```bash
npm run db:seed   # fórmula demo + 2 ingredientes
```

## Schema

`sql/001_init.sql`: labs, users, icbf_foods, ingredients, formulas, formula_lines, audit_events.  
Tracking de migraciones: tabla `schema_migrations` (gestionada por `npm run db:migrate`).  
También se monta en `docker-entrypoint-initdb.d` la primera vez que se crea el volumen Docker.
