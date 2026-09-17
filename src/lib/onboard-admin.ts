import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { sendWelcomeAdminEmail } from "./auth-emails.js";
import { generateTempPassword } from "./passwords.js";

export type OnboardAdminResult = {
  userId: string;
  email: string;
  name: string;
  temporaryPassword: string;
  emailSent: boolean;
  smtpPending: boolean;
};

export async function createOnboardedAdmin(
  pool: Pool,
  input: {
    labId: string;
    labName: string;
    name: string;
    email: string;
  },
): Promise<OnboardAdminResult> {
  const email = input.email.trim().toLowerCase();
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const insert = await pool.query(
    `INSERT INTO users (
       lab_id, email, name, password_hash, role, active,
       must_change_password, mfa_enabled, email_confirmed_at
     )
     VALUES ($1, $2, $3, $4, 'lab_admin', true, true, false, NULL)
     RETURNING id, email, name`,
    [input.labId, email, input.name.trim(), passwordHash],
  );
  const row = insert.rows[0];

  const mail = await sendWelcomeAdminEmail({
    to: email,
    name: input.name.trim(),
    labName: input.labName,
    tempPassword,
  });

  return {
    userId: String(row.id),
    email: String(row.email),
    name: String(row.name),
    temporaryPassword: tempPassword,
    emailSent: !mail.mocked,
    smtpPending: mail.mocked,
  };
}

export async function rotateOnboardPassword(
  pool: Pool,
  input: {
    userId: string;
    labName: string;
    name: string;
    email: string;
  },
): Promise<OnboardAdminResult> {
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    `UPDATE users
     SET password_hash = $2,
         must_change_password = true,
         mfa_enabled = false,
         email_confirmed_at = NULL,
         password_changed_at = NULL
     WHERE id = $1`,
    [input.userId, passwordHash],
  );

  const mail = await sendWelcomeAdminEmail({
    to: input.email,
    name: input.name,
    labName: input.labName,
    tempPassword,
  });

  return {
    userId: input.userId,
    email: input.email,
    name: input.name,
    temporaryPassword: tempPassword,
    emailSent: !mail.mocked,
    smtpPending: mail.mocked,
  };
}

export function publicOnboardMail(result: OnboardAdminResult) {
  return {
    admin: { id: result.userId, email: result.email, name: result.name },
    emailSent: result.emailSent,
    smtpPending: result.smtpPending,
    // Sin SMTP el superadmin copia la temporal. Con SMTP no viaja en la API.
    temporaryPassword: result.smtpPending ? result.temporaryPassword : undefined,
    message: result.smtpPending
      ? "Admin creado. SMTP aún no está configurado: copia la contraseña temporal y compártela de forma segura. El correo se enviará cuando existan SMTP_HOST / SMTP_USER / SMTP_PASS."
      : `Se envió el correo de registro a ${result.email} con el enlace de primer acceso y la contraseña temporal.`,
  };
}
