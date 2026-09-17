import type { Pool } from "pg";

export function formatIngredientCode(seq: number): string {
  return `IN-${String(seq).padStart(5, "0")}`;
}

/** Reserva el siguiente código del laboratorio (IN-00001…). */
export async function allocateIngredientCode(
  pool: Pool,
  labId: string,
): Promise<string> {
  const result = await pool.query<{ ingredient_code_seq: number }>(
    `UPDATE labs
     SET ingredient_code_seq = ingredient_code_seq + 1
     WHERE id = $1
     RETURNING ingredient_code_seq`,
    [labId],
  );
  const seq = Number(result.rows[0]?.ingredient_code_seq) || 1;
  return formatIngredientCode(seq);
}

export async function peekIngredientCode(
  pool: Pool,
  labId: string,
): Promise<string> {
  const result = await pool.query<{ ingredient_code_seq: number }>(
    `SELECT ingredient_code_seq FROM labs WHERE id = $1`,
    [labId],
  );
  const seq = (Number(result.rows[0]?.ingredient_code_seq) || 0) + 1;
  return formatIngredientCode(seq);
}
