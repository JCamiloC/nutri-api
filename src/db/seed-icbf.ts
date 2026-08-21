import "dotenv/config";
import { getPool } from "./pool.js";

/** Muestra local de TCA/ICBF para poder buscar sin el Excel/MySQL completo. */
const SAMPLE: Array<{
  codigo: string;
  nombre: string;
  parte: string;
  energia: number;
  proteina: number;
  grasas: number;
  cho: number;
  fibra: number;
  sodio: number;
  potasio: number;
  azucar: number;
  saturada: number;
  humedad: number;
}> = [
  { codigo: "M-001", nombre: "Azúcar blanca", parte: "Producto", energia: 387, proteina: 0, grasas: 0, cho: 99.5, fibra: 0, sodio: 1, potasio: 2, azucar: 99.5, saturada: 0, humedad: 0.5 },
  { codigo: "M-002", nombre: "Agua potable", parte: "Líquido", energia: 0, proteina: 0, grasas: 0, cho: 0, fibra: 0, sodio: 0, potasio: 0, azucar: 0, saturada: 0, humedad: 100 },
  { codigo: "M-003", nombre: "Leche de vaca entera", parte: "Líquido", energia: 61, proteina: 3.2, grasas: 3.3, cho: 4.7, fibra: 0, sodio: 44, potasio: 150, azucar: 4.7, saturada: 1.9, humedad: 88 },
  { codigo: "M-004", nombre: "Harina de trigo", parte: "Producto", energia: 364, proteina: 10.3, grasas: 1.0, cho: 76.3, fibra: 2.7, sodio: 2, potasio: 107, azucar: 0.3, saturada: 0.2, humedad: 12 },
  { codigo: "M-005", nombre: "Aceite de soya", parte: "Producto", energia: 884, proteina: 0, grasas: 100, cho: 0, fibra: 0, sodio: 0, potasio: 0, azucar: 0, saturada: 15.7, humedad: 0 },
  { codigo: "M-006", nombre: "Sal de cocina", parte: "Producto", energia: 0, proteina: 0, grasas: 0, cho: 0, fibra: 0, sodio: 38758, potasio: 8, azucar: 0, saturada: 0, humedad: 0.2 },
  { codigo: "M-007", nombre: "Huevo de gallina", parte: "Entero", energia: 143, proteina: 12.6, grasas: 9.5, cho: 0.7, fibra: 0, sodio: 142, potasio: 126, azucar: 0.4, saturada: 3.1, humedad: 76 },
  { codigo: "M-008", nombre: "Arroz blanco crudo", parte: "Grano", energia: 365, proteina: 7.1, grasas: 0.7, cho: 80, fibra: 1.3, sodio: 5, potasio: 115, azucar: 0.1, saturada: 0.2, humedad: 12 },
  { codigo: "M-009", nombre: "Avena en hojuelas", parte: "Producto", energia: 389, proteina: 16.9, grasas: 6.9, cho: 66.3, fibra: 10.6, sodio: 2, potasio: 429, azucar: 0.99, saturada: 1.2, humedad: 8 },
  { codigo: "M-010", nombre: "Cacao en polvo", parte: "Producto", energia: 228, proteina: 19.6, grasas: 13.7, cho: 57.9, fibra: 37, sodio: 21, potasio: 1524, azucar: 1.8, saturada: 8.1, humedad: 3 },
  { codigo: "M-011", nombre: "Café soluble", parte: "Producto", energia: 241, proteina: 12.2, grasas: 0.5, cho: 41.1, fibra: 0, sodio: 37, potasio: 3535, azucar: 0, saturada: 0.2, humedad: 3 },
  { codigo: "M-012", nombre: "Miel de abejas", parte: "Producto", energia: 304, proteina: 0.3, grasas: 0, cho: 82.4, fibra: 0.2, sodio: 4, potasio: 52, azucar: 82.1, saturada: 0, humedad: 17 },
  { codigo: "M-013", nombre: "Yogur natural entero", parte: "Lácteo", energia: 61, proteina: 3.5, grasas: 3.3, cho: 4.7, fibra: 0, sodio: 46, potasio: 155, azucar: 4.7, saturada: 2.1, humedad: 88 },
  { codigo: "M-014", nombre: "Maíz blanco seco", parte: "Grano", energia: 365, proteina: 9.4, grasas: 4.7, cho: 74.3, fibra: 7.3, sodio: 35, potasio: 287, azucar: 0.6, saturada: 0.7, humedad: 10 },
  { codigo: "M-015", nombre: "Soya grano seco", parte: "Grano", energia: 446, proteina: 36.5, grasas: 19.9, cho: 30.2, fibra: 9.3, sodio: 2, potasio: 1797, azucar: 7.3, saturada: 2.9, humedad: 8.5 },
  { codigo: "M-016", nombre: "Panela", parte: "Producto", energia: 310, proteina: 0.5, grasas: 0.1, cho: 86, fibra: 0, sodio: 12, potasio: 100, azucar: 86, saturada: 0, humedad: 9 },
];

async function main() {
  const pool = getPool();
  let inserted = 0;
  for (const food of SAMPLE) {
    const result = await pool.query(
      `INSERT INTO icbf_foods (
        codigo, nombre, parte_analizada, fuente,
        energia_kcal, proteina, grasas, grasa_saturada, carbohidratos, fibra,
        sodio, potasio, azucar, humedad
      ) VALUES ($1,$2,$3,'ICBF TCA (muestra local)',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (codigo) DO NOTHING`,
      [
        food.codigo,
        food.nombre,
        food.parte,
        food.energia,
        food.proteina,
        food.grasas,
        food.saturada,
        food.cho,
        food.fibra,
        food.sodio,
        food.potasio,
        food.azucar,
        food.humedad,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  const total = await pool.query(`SELECT count(*)::int AS n FROM icbf_foods`);
  console.log(`[seed-icbf] insertados ${inserted}; total icbf_foods=${total.rows[0].n}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed-icbf] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
