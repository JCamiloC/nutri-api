import "dotenv/config";
import bcrypt from "bcryptjs";
import { DEMO_LAB_ID } from "../config/constants.js";
import { getPool } from "./pool.js";

/** Contraseña demo compartida (solo desarrollo). */
export const DEMO_PASSWORD = "demo1234";

const USERS = [
  {
    email: "admin@andeslab.co",
    name: "Admin Andes Lab",
    role: "lab_admin" as const,
    labId: DEMO_LAB_ID,
  },
  {
    email: "lectura@andeslab.co",
    name: "Lectura Andes Lab",
    role: "lab_reader" as const,
    labId: DEMO_LAB_ID,
  },
  {
    email: "super@enerxis.com",
    name: "Superadmin Enerxis",
    role: "superadmin" as const,
    labId: null as string | null,
  },
];

async function main() {
  const pool = getPool();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await pool.query(
    `INSERT INTO labs (id, name, status, plan_id, city)
     VALUES ($1, 'Andes Lab Demo', 'activo', 'pro', 'Bogotá')
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_LAB_ID],
  );

  for (const u of USERS) {
    await pool.query(
      `INSERT INTO users (email, name, password_hash, role, lab_id, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         lab_id = EXCLUDED.lab_id,
         active = true`,
      [u.email, u.name, hash, u.role, u.labId],
    );
    console.log(`[seed-users] ${u.email} (${u.role})`);
  }

  console.log(`[seed-users] password demo: ${DEMO_PASSWORD}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed-users] failed:", error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
