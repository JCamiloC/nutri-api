/**
 * Mailer compartido. Sin SMTP → modo mock (log + mocked:true).
 * Cuando Enerxis defina correo corporativo, configurar SMTP_* y deja de mockear.
 */
import nodemailer from "nodemailer";

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
};

function smtpFromAddress(): string {
  const raw = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER || "";
  const match = /<([^>]+)>/.exec(raw);
  if (match) return match[1].trim();
  if (raw.includes("@")) return raw.replace(/^"|"$/g, "").trim();
  return raw;
}

function smtpFromHeader(fromName?: string): string {
  const address = smtpFromAddress();
  const name = fromName?.trim();
  if (name && address) return `"${name.replace(/"/g, "")}" <${address}>`;
  return process.env.SMTP_FROM?.trim() || process.env.SMTP_USER || address;
}

export type SendMailResult = {
  ok: true;
  mocked: boolean;
};

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!smtpConfigured()) {
    console.info("[mailer] MOCK (SMTP no configurado)", {
      to: input.to,
      subject: input.subject,
    });
    console.info("[mailer] MOCK body:\n" + input.text);
    return { ok: true, mocked: true };
  }

  const from = smtpFromHeader(input.fromName);
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from,
    to: input.to,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return { ok: true, mocked: false };
}

export function appPublicUrl(): string {
  return (
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.CORS_ORIGIN?.split(",")[0]?.trim() ||
    "http://localhost:3002"
  );
}
