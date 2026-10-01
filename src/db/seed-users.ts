import "dotenv/config";
import bcrypt from "bcryptjs";
import { DEMO_LAB_ID, HIDRO_LAB_ID } from "../config/constants.js";
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
    email: "andres@andeslab.co",
    name: "Andrés Soto",
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
    email: "admin@hidro.co",
    name: "Admin Hidro",
    role: "lab_admin" as const,
    labId: HIDRO_LAB_ID,
  },
  {
    email: "super@enerxis.com",
    name: "Superadmin Enerxis",
    role: "superadmin" as const,
    labId: null as string | null,
  },
];

async function upsertProLab(id: string, name: string, city: string) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO labs (id, name, status, plan_id, tables_extra, city, renews_at)
     VALUES ($1, $2, 'activo', 'pro', 5, $3, (CURRENT_DATE + INTERVAL '30 days')::date)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       status = 'activo',
       plan_id = 'pro',
       tables_extra = GREATEST(labs.tables_extra, 5),
       city = EXCLUDED.city,
       renews_at = COALESCE(labs.renews_at, EXCLUDED.renews_at),
       updated_at = now()`,
    [id, name, city],
  );
}

async function main() {
  const pool = getPool();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await upsertProLab(DEMO_LAB_ID, "Andes Lab Demo", "Bogotá");
  await upsertProLab(HIDRO_LAB_ID, "Hidro Lab", "Bogotá");

  for (const u of USERS) {
    await pool.query(
      `INSERT INTO users (email, name, password_hash, role, lab_id, active, must_change_password, email_confirmed_at, mfa_enabled)
       VALUES ($1, $2, $3, $4, $5, true, false, now(), false)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         lab_id = EXCLUDED.lab_id,
         active = true,
         must_change_password = false,
         email_confirmed_at = COALESCE(users.email_confirmed_at, now()),
         mfa_enabled = false`,
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
