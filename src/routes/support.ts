import { Router } from "express";
import { z } from "zod";
import { writeAudit } from "../lib/audit.js";
import { sendMail, smtpConfigured } from "../lib/mailer.js";
import { resolveLabId } from "../lib/mappers.js";
import { requireAuth } from "../middleware/auth.js";

export const supportRouter = Router();

const ticketBody = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(5000),
});

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

    const mail = await sendMail({
      to: supportTo,
      replyTo: user.email,
      subject: mailSubject,
      text: body,
    });

    await writeAudit(req, {
      labId,
      action: "support.ticket",
      detail: `${mail.mocked ? "[mock] " : ""}${subject.slice(0, 160)}`,
    });

    if (mail.mocked) {
      return res.json({
        ok: true,
        mocked: true,
        smtpPending: !smtpConfigured(),
        message:
          "Ticket registrado (modo prueba: el correo aún no está conectado). Quedó en auditoría del laboratorio.",
      });
    }

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
