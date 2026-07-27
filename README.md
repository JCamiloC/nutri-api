# nutri-api

API Node (Express + TypeScript) para **Enerxis NutriLab**.  
Repo: [JCamiloC/nutri-api](https://github.com/JCamiloC/nutri-api).

## Enfoque de BD

**Postgres en el servidor (VPS)** — no dependemos de Docker local.

1. Clona este repo en el VPS.
2. Crea Postgres (mismo VPS o managed).
3. Copia `.env.example` → `.env` y configura `DATABASE_URL`.
4. `npm ci && npm run db:migrate && npm run build && npm start`

## Arranque

```bash
npm ci
cp .env.example .env   # editar DATABASE_URL, PORT, CORS_ORIGIN
npm run db:migrate
npm run dev            # http://localhost:4000
```

Sin BD puedes probar el motor:

```bash
npm run test:engine
```

## Endpoints

| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/health` | Estado API + DB |
| POST | `/v1/recalculate` | Motor nutricional (sin persistencia) |

## Schema

`sql/001_init.sql`: labs, users, icbf_foods, ingredients, formulas, formula_lines, audit_events.
