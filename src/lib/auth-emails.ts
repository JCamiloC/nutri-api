import { appPublicUrl, sendMail, type SendMailResult } from "./mailer.js";
import {
  loadPlatformBranding,
  mergePlatformBrandingDraft,
  type PlatformBranding,
  type PlatformBrandingDraft,
} from "./platform-branding.js";

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loginUrl(email?: string): string {
  const base = appPublicUrl().replace(/\/$/, "");
  if (!email) return `${base}/login/`;
  return `${base}/login/?email=${encodeURIComponent(email)}`;
}

function initials(productName: string): string {
  const parts = productName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return productName.slice(0, 2).toUpperCase() || "NL";
}

export function renderBrandedHtml(
  branding: PlatformBranding,
  title: string,
  inner: string,
): string {
  const b = branding;
  const logo = b.logoAbsoluteUrl
    ? `<img src="${htmlEscape(b.logoAbsoluteUrl)}" alt="${htmlEscape(b.productName)}" width="160" style="display:block;max-width:160px;max-height:48px;height:auto;border:0;" />`
    : `<div style="display:inline-block;background:${htmlEscape(b.accentColor)};color:#fff;font-weight:700;font-size:14px;padding:10px 12px;border-radius:10px;">${htmlEscape(initials(b.productName))}</div>`;

  const footerBits = [
    b.emailFooter ? htmlEscape(b.emailFooter) : null,
    `${htmlEscape(b.productName)} · ${htmlEscape(b.companyName)}`,
    b.supportEmail
      ? `Soporte: <a href="mailto:${htmlEscape(b.supportEmail)}" style="color:${htmlEscape(b.accentColor)};">${htmlEscape(b.supportEmail)}</a>`
      : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:${htmlEscape(b.pageColor)};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${htmlEscape(b.inkColor)};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${htmlEscape(b.pageColor)};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(15,23,42,0.1);">
          <tr>
            <td style="padding:22px 28px 8px 28px;">
              ${logo}
              <p style="margin:12px 0 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${htmlEscape(b.accentColor)};">${htmlEscape(b.companyName)} · ${htmlEscape(b.productName)}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#37566f;">${htmlEscape(b.tagline)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;">
              <h1 style="margin:12px 0 16px;font-size:22px;line-height:1.3;color:${htmlEscape(b.inkColor)};">${htmlEscape(title)}</h1>
              ${inner}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid rgba(15,23,42,0.08);font-size:12px;color:#37566f;line-height:1.5;">
              ${footerBits.join("<br/>")}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function cta(branding: PlatformBranding, href: string, label: string): string {
  return `<p style="margin:20px 0;"><a href="${htmlEscape(href)}" style="display:inline-block;background:${htmlEscape(branding.inkColor)};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">${htmlEscape(label)}</a></p>`;
}

async function sendBranded(input: {
  to: string;
  subject: string;
  text: string;
  title: string;
  inner: string;
  branding?: PlatformBranding;
}): Promise<SendMailResult> {
  const branding = input.branding ?? (await loadPlatformBranding());
  return sendMail({
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: renderBrandedHtml(branding, input.title, input.inner),
    fromName: branding.emailFromName,
  });
}

export type EmailKind = "welcome" | "mfa" | "reset" | "invite";

export function buildEmailContent(
  branding: PlatformBranding,
  kind: EmailKind,
  sample?: {
    name?: string;
    email?: string;
    labName?: string;
    tempPassword?: string;
    code?: string;
    minutes?: number;
    url?: string;
  },
): { title: string; subject: string; text: string; inner: string } {
  const name = sample?.name ?? "Ana Pérez";
  const email = sample?.email ?? "ana@laboratorio.com";
  const labName = sample?.labName ?? "Laboratorio ejemplo";
  const tempPassword = sample?.tempPassword ?? "••••••••";
  const code = sample?.code ?? "123456";
  const minutes = sample?.minutes ?? 10;
  const product = branding.productName;
  const company = branding.companyName;

  if (kind === "welcome") {
    const url = sample?.url ?? loginUrl(email);
    const intro =
      branding.welcomeIntro ||
      `Confirmamos el registro de tu laboratorio ${labName} en ${product}.`;
    const title = "Registro confirmado";
    const subject = `Registro confirmado — ${product}`;
    const text = [
      `Hola ${name},`,
      ``,
      intro,
      ``,
      `Entra por primera vez aquí:`,
      url,
      ``,
      `Usuario: ${email}`,
      `Contraseña temporal: ${tempPassword}`,
      ``,
      `Al iniciar sesión te pediremos cambiar la contraseña. Después, cada ingreso enviará un código de 6 dígitos a este correo.`,
      branding.emailFooter ? `` : null,
      branding.emailFooter,
    ]
      .filter((line) => line !== null)
      .join("\n");
    const inner = `
      <p>Hola ${htmlEscape(name)},</p>
      <p>${htmlEscape(intro)}</p>
      ${cta(branding, url, "Iniciar sesión por primera vez")}
      <p>Usuario: <strong>${htmlEscape(email)}</strong><br/>Contraseña temporal: <strong>${htmlEscape(tempPassword)}</strong></p>
      <p>Al entrar te pediremos cambiar la contraseña. Después, cada inicio de sesión pedirá un código de 6 dígitos enviado a este correo.</p>`;
    return { title, subject, text, inner };
  }

  if (kind === "mfa") {
    const intro =
      branding.mfaIntro ||
      `Tu código de acceso a ${product} es:`;
    const title = "Código de acceso";
    const subject = `Código de acceso ${product}`;
    const text = [
      `Hola ${name},`,
      ``,
      intro,
      `${code}`,
      `Válido por ${minutes} minutos.`,
      ``,
      `Si no intentaste iniciar sesión, ignora este correo.`,
    ].join("\n");
    const inner = `
      <p>Hola ${htmlEscape(name)},</p>
      <p>${htmlEscape(intro)}</p>
      <p style="font-size:32px;letter-spacing:0.28em;font-weight:700;margin:12px 0;color:${htmlEscape(branding.inkColor)};">${htmlEscape(code)}</p>
      <p>Válido por ${minutes} minutos. Si no intentaste iniciar sesión, ignora este correo.</p>`;
    return { title, subject, text, inner };
  }

  if (kind === "invite") {
    const url = sample?.url ?? loginUrl();
    const intro = branding.inviteIntro || `Te invitaron a ${product}.`;
    const title = "Invitación";
    const subject = `Invitación a ${product} — ${company}`;
    const text = [
      `Hola ${name},`,
      ``,
      intro,
      `Accede en: ${url}`,
      `Email: ${email}`,
      tempPassword === "••••••••"
        ? `Usa la contraseña que te indicaron.`
        : `Contraseña temporal: ${tempPassword}`,
      ``,
      `Te recomendamos cambiarla al entrar (Cuenta → Cambiar contraseña).`,
    ].join("\n");
    const inner = `
      <p>Hola ${htmlEscape(name)},</p>
      <p>${htmlEscape(intro)}</p>
      ${cta(branding, url, "Entrar a " + product)}
      <p>Email: <strong>${htmlEscape(email)}</strong>${
        tempPassword === "••••••••"
          ? ""
          : `<br/>Contraseña temporal: <strong>${htmlEscape(tempPassword)}</strong>`
      }</p>
      <p>Te recomendamos cambiarla al entrar (Cuenta → Cambiar contraseña).</p>`;
    return { title, subject, text, inner };
  }

  const url = sample?.url ?? `${appPublicUrl().replace(/\/$/, "")}/reset-password/`;
  const intro =
    branding.resetIntro ||
    "Usa este enlace para restablecer tu contraseña (válido unas horas):";
  const title = "Restablecer contraseña";
  const subject = `Restablecer contraseña — ${product}`;
  const text = [
    `Hola ${name},`,
    ``,
    intro,
    url,
    ``,
    `Si no pediste este cambio, ignora este correo.`,
  ].join("\n");
  const inner = `
    <p>Hola ${htmlEscape(name)},</p>
    <p>${htmlEscape(intro)}</p>
    ${cta(branding, url, "Elegir nueva contraseña")}
    <p>Si no pediste este cambio, ignora este correo.</p>`;
  return { title, subject, text, inner };
}

export async function renderEmailPreview(
  kind: EmailKind,
  draft?: PlatformBrandingDraft,
): Promise<{
  subject: string;
  html: string;
  branding: PlatformBranding;
}> {
  const saved = await loadPlatformBranding();
  const branding = mergePlatformBrandingDraft(saved, draft);
  const sample =
    kind === "welcome" || kind === "invite"
      ? { tempPassword: "Ab12xyZ9qweR", labName: "Laboratorio ejemplo" }
      : undefined;
  const content = buildEmailContent(branding, kind, sample);
  return {
    subject: content.subject,
    html: renderBrandedHtml(branding, content.title, content.inner),
    branding,
  };
}

export async function sendWelcomeAdminEmail(input: {
  to: string;
  name: string;
  labName: string;
  tempPassword: string;
}): Promise<SendMailResult> {
  const branding = await loadPlatformBranding();
  const content = buildEmailContent(branding, "welcome", {
    name: input.name,
    email: input.to,
    labName: input.labName,
    tempPassword: input.tempPassword,
    url: loginUrl(input.to),
  });
  return sendBranded({
    to: input.to,
    branding,
    ...content,
  });
}

export async function sendMfaCodeEmail(input: {
  to: string;
  name: string;
  code: string;
  minutes: number;
}): Promise<SendMailResult> {
  const branding = await loadPlatformBranding();
  const content = buildEmailContent(branding, "mfa", {
    name: input.name,
    email: input.to,
    code: input.code,
    minutes: input.minutes,
  });
  return sendBranded({ to: input.to, branding, ...content });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<SendMailResult> {
  const branding = await loadPlatformBranding();
  const content = buildEmailContent(branding, "reset", {
    name: input.name,
    email: input.to,
    url: input.resetUrl,
  });
  return sendBranded({ to: input.to, branding, ...content });
}

export async function sendInviteEmail(input: {
  to: string;
  name: string;
  tempPassword?: string;
}): Promise<SendMailResult> {
  const branding = await loadPlatformBranding();
  const content = buildEmailContent(branding, "invite", {
    name: input.name,
    email: input.to,
    tempPassword: input.tempPassword,
    url: loginUrl(),
  });
  return sendBranded({ to: input.to, branding, ...content });
}
