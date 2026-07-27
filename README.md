# nutri-api

API Node (Express + TypeScript) para **Enerxis NutriLab**.  
Carpeta ignorada por el Git de `nutri-saas`; usa **su propio repo**.

## Estado actual

| Pieza | Estado |
|-------|--------|
| Motor `nutrition-engine` | Reglas portadas de `imprimirReceta.js` (suma %, calorías, formatos, leyenda, vitaminas) |
| Schema SQL | `sql/001_init.sql` (labs, users, icbf_foods, ingredients, formulas, formula_lines, audit) |
| Postgres Docker | `docker-compose.yml` listo — **requiere Docker Desktop engine OK** |
| Endpoint | `GET /health`, `POST /v1/recalculate` |

## Arranque rápido

```bash
cd nutri-api
npm install
npm run test:engine    # no necesita BD
npm run dev            # http://localhost:4000
```

### Postgres con Docker

1. Abre **Docker Desktop** y espera a que diga *Engine running* (ballena estable).
2. Si falla al iniciar: reinicia Docker Desktop, confirma WSL2 habilitado, o reinicia Windows tras la instalación.
3. Luego:

```bash
npm run db:up
npm run db:migrate
```

Credenciales por defecto (`.env`):

```text
postgresql://nutri:nutri@127.0.0.1:5432/nutri_lab
```

### Si Docker no arranca (alternativa)

Instala Postgres 16 nativo:

```bash
winget install PostgreSQL.PostgreSQL.16
```

Crea usuario/DB `nutri` / `nutri_lab`, ajusta `DATABASE_URL` en `.env`, y:

```bash
npm run db:migrate
```

## Schema (resumen)

Alineado a Enerxis + multi-tenant SaaS:

- `labs`, `users` — tenancy / roles
- `icbf_foods` — catálogo ICBF (ex `icbf_alimentos`)
- `ingredients` — inventario por lab (BD / API / ICBF), macros en columnas + `vitaminas`/`alergenos` JSONB
- `formulas` — ex `recetas` (tipo Solido/Liquido/Reconstituida, peso, porciones, rotulado)
- `formula_lines` — ex `datosRecetas` (% + fuente + ref)
- `audit_events` — bitácora SaaS

Lab demo sembrado: `00000000-0000-4000-8000-000000000001`.

## Motor — reglas ya portadas

Desde `Enerxis/cotizador/js/imprimirReceta.js`:

- Factor línea = `% / 100`
- Macros ponderados (`grasas` → `grasa`, etc.)
- Calorías: `grasa*9 + (carb-fibra)*4 + fibra*2 + proteina*4`
- Micros vía `vitaminas[{nombre,valor}]` + aliases legacy (`Iron`→`hierro`, …)
- Factores Solido/Liquido/Reconstituida
- `formatMacroValue` / `formatMicroValue`
- Leyenda “No es fuente significativa de …”
- Lista de ingredientes ordenada por aporte

Probar:

```bash
npm run test:engine
curl -s http://localhost:4000/v1/recalculate -H "Content-Type: application/json" -d "{\"packageWeight\":30,\"formulaType\":\"Solido\",\"lines\":[{\"source\":\"BD\",\"name\":\"Demo\",\"percent\":100,\"per100g\":{\"grasas\":1,\"proteina\":20,\"carbohidratos\":10,\"fibra\":0,\"sodio\":50}}]}"
```

## Próximo

1. Confirmar Docker engine → `db:up` + `db:migrate`
2. CRUD formulas/ingredients
3. Import ICBF
4. Proxy USDA (API key solo en servidor)
