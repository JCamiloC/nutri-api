import { Router } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { writeAudit } from "../lib/audit.js";
import { resolveLabId } from "../lib/mappers.js";
import { requireAuth } from "../middleware/auth.js";

export const supportRouter = Router();

const ticketBody = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(5000),
});

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

supportRouter.post("/v1/support/tickets", requireAuth, async (req, res) => {
  try {
    const parsed = ticketBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_body",
        details: parsed.error.flatten(),
        message: "Revisa el asunto (mín. 3) y el mensaje (mín. 10 caracteres).",
      });
    }

    const user = req.user!;
    let labId: string | null = null;
    try {
      labId = resolveLabId(req);
    } catch {
      labId = user.labId ?? null;
    }

    const { subject, message } = parsed.data;
    const supportTo = process.env.SUPPORT_EMAIL?.trim() || "soporte@enerxis.com";
    const mailSubject = `[NutriLab] ${subject}`;
    const body = [
      `Ticket de mesa de ayuda — Enerxis NutriLab`,
      ``,
      `De: ${user.name} <${user.email}>`,
      `Rol: ${user.role}`,
      `Lab ID: ${labId ?? "n/a"}`,
      `Fecha: ${new Date().toISOString()}`,
      ``,
      `Asunto: ${subject}`,
      ``,
      message,
    ].join("\n");

    // Sin SMTP: modo mock (acepta el ticket, audita y loguea; listo para prod sin correo real).
    if (!smtpConfigured()) {
      console.info("[support] MOCK ticket (SMTP no configurado)", {
        to: supportTo,
        from: user.email,
        subject: mailSubject,
        labId,
      });
      console.info("[support] MOCK body:\n" + body);

      await writeAudit(req, {
        labId,
        action: "support.ticket",
        detail: `[mock] ${subject.slice(0, 160)}`,
      });

      return res.json({
        ok: true,
        mocked: true,
        message:
          "Ticket registrado (modo prueba: el correo aún no está conectado). Quedó en auditoría del laboratorio.",
      });
    }

    const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER!;
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
      to: supportTo,
      replyTo: user.email,
      subject: mailSubject,
      text: body,
    });

    await writeAudit(req, {
      labId,
      action: "support.ticket",
      detail: subject.slice(0, 180),
    });

    return res.json({
      ok: true,
      mocked: false,
      message: "Ticket enviado. Te responderemos al correo de tu cuenta.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "support_ticket_failed", message });
  }
});
