import { randomBytes, randomInt } from "node:crypto";

/** Contraseña temporal legible para el correo de alta. */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 12);
}

/** Código numérico de 6 dígitos para MFA por correo. */
export function generateMfaCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function mfaCodeTtlMinutes(): number {
  const n = Number(process.env.MFA_CODE_MINUTES || 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}
