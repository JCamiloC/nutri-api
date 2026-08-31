# Catálogos versionados para producción

| Archivo | Destino | Script |
|---------|---------|--------|
| `BD_ICBF.xlsx` | `icbf_foods` | `npm run db:import-icbf-excel` |
| `BASE_ENERXIS_INGREDIENTES.xlsx` | `ingredients` (`is_base`) | `npm run db:import-base-excel` |

Ambos: `npm run db:import-catalog` (post-migrate en deploy).
Celdas vacías se importan como **0**.
