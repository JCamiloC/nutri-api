import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { renderEmailPreview, type EmailKind } from "../lib/auth-emails.js";
import {
  loadPlatformBranding,
  mapPlatformRow,
  publicBrandingPayload,
  type PlatformBrandingDraft,
} from "../lib/platform-branding.js";
import {
  ensurePlatformDir,
  extFromMime,
  normalizeImageExt,
  platformLogoPath,
  removePlatformLogoFiles,
} from "../lib/uploads.js";
import { requireAuth, requireSuperadmin } from "../middleware/auth.js";

export const platformRouter = Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hex #RRGGBB");

const patchBody = z.object({
  productName: z.string().trim().min(1).max(80).optional(),
  companyName: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  supportEmail: z.string().trim().email().max(200).optional().nullable(),
  inkColor: color.optional(),
  accentColor: color.optional(),
  pageColor: color.optional(),
  emailFromName: z.string().trim().max(80).optional().nullable(),
  emailFooter: z.string().trim().max(500).optional().nullable(),
  welcomeIntro: z.string().trim().max(2000).optional().nullable(),
  mfaIntro: z.string().trim().max(2000).optional().nullable(),
  inviteIntro: z.string().trim().max(2000).optional().nullable(),
  resetIntro: z.string().trim().max(2000).optional().nullable(),
});

const previewDraft = patchBody.partial();
const previewBody = z.object({
  kind: z.enum(["welcome", "mfa", "reset", "invite"]).optional(),
  draft: previewDraft.optional(),
});

async function currentRow() {
  const pool = getPool();
  await pool.query(
    `INSERT INTO platform_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`,
  );
  const result = await pool.query(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`);
  return result.rows[0];
}

/** Público: login y chrome del front. */
platformRouter.get("/v1/branding", async (_req, res) => {
  try {
    const branding = await loadPlatformBranding();
    return res.json(publicBrandingPayload(branding));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_branding_failed", message });
  }
});

platformRouter.get("/v1/platform/branding", requireAuth, requireSuperadmin, async (_req, res) => {
  try {
    return res.json(await loadPlatformBranding());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_platform_branding_failed", message });
  }
});

platformRouter.patch("/v1/platform/branding", requireAuth, requireSuperadmin, async (req, res) => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const d = parsed.data;
  try {
    const current = await currentRow();
    const result = await getPool().query(
      `UPDATE platform_settings SET
         product_name = $1,
         company_name = $2,
         tagline = $3,
         support_email = $4,
         ink_color = $5,
         accent_color = $6,
         page_color = $7,
         email_from_name = $8,
         email_footer = $9,
         welcome_intro = $10,
         mfa_intro = $11,
         invite_intro = $12,
         reset_intro = $13,
         updated_at = now()
       WHERE id = 'default'
       RETURNING *`,
      [
        d.productName ?? current.product_name,
        d.companyName ?? current.company_name,
        d.tagline ?? current.tagline,
        d.supportEmail === undefined ? current.support_email : d.supportEmail,
        d.inkColor ?? current.ink_color,
        d.accentColor ?? current.accent_color,
        d.pageColor ?? current.page_color,
        d.emailFromName === undefined ? current.email_from_name : d.emailFromName,
        d.emailFooter === undefined ? current.email_footer : d.emailFooter,
        d.welcomeIntro === undefined ? current.welcome_intro : d.welcomeIntro,
        d.mfaIntro === undefined ? current.mfa_intro : d.mfaIntro,
        d.inviteIntro === undefined ? current.invite_intro : d.inviteIntro,
        d.resetIntro === undefined ? current.reset_intro : d.resetIntro,
      ],
    );
    await writeAudit(req, {
      action: "platform.update_branding",
      detail: `${result.rows[0]?.product_name} · ${result.rows[0]?.company_name}`,
    });
    return res.json(mapPlatformRow(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_platform_branding_failed", message });
  }
});

const logoBody = z.object({
  dataUrl: z.string().min(32).max(3_500_000),
});

platformRouter.post("/v1/platform/logo", requireAuth, requireSuperadmin, async (req, res) => {
  const parsed = logoBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(parsed.data.dataUrl.trim());
  if (!match) {
    return res.status(400).json({
      error: "invalid_data_url",
      message: "Se espera data URL de imagen (png, jpg, webp o svg)",
    });
  }
  const mime = match[1];
  const ext = extFromMime(mime) ?? normalizeImageExt(mime.split("/")[1] ?? "");
  if (!ext) {
    return res.status(400).json({
      error: "unsupported_image",
      message: "Formatos permitidos: PNG, JPG, WEBP, SVG",
    });
  }
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length < 32 || buffer.length > 2_500_000) {
      return res.status(400).json({
        error: "invalid_size",
        message: "El logo debe pesar entre 32 B y 2.5 MB",
      });
    }
    ensurePlatformDir();
    removePlatformLogoFiles();
    fs.writeFileSync(platformLogoPath(ext), buffer);
    await currentRow();
    const result = await getPool().query(
      `UPDATE platform_settings SET logo_ext = $1, updated_at = now() WHERE id = 'default' RETURNING *`,
      [ext],
    );
    await writeAudit(req, {
      action: "platform.upload_logo",
      detail: `logo.${ext} (${buffer.length} bytes)`,
    });
    return res.json(mapPlatformRow(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "upload_platform_logo_failed", message });
  }
});

platformRouter.delete("/v1/platform/logo", requireAuth, requireSuperadmin, async (req, res) => {
  try {
    removePlatformLogoFiles();
    const result = await getPool().query(
      `UPDATE platform_settings SET logo_ext = NULL, updated_at = now() WHERE id = 'default' RETURNING *`,
    );
    await writeAudit(req, { action: "platform.delete_logo", detail: "Logo de plataforma eliminado" });
    return res.json(mapPlatformRow(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_platform_logo_failed", message });
  }
});

platformRouter.get("/v1/platform/email-preview", requireAuth, requireSuperadmin, async (req, res) => {
  const kindRaw = String(req.query.kind ?? "welcome");
  const kind = (["welcome", "mfa", "reset", "invite"] as EmailKind[]).includes(kindRaw as EmailKind)
    ? (kindRaw as EmailKind)
    : "welcome";
  try {
    const preview = await renderEmailPreview(kind);
    return res.json({
      kind,
      subject: preview.subject,
      html: preview.html,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "email_preview_failed", message });
  }
});

/** Vista previa en vivo con borrador (estilo personalizador WordPress). */
platformRouter.post("/v1/platform/email-preview", requireAuth, requireSuperadmin, async (req, res) => {
  const parsed = previewBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const kind = parsed.data.kind ?? "welcome";
  try {
    const draft = parsed.data.draft as PlatformBrandingDraft | undefined;
    const preview = await renderEmailPreview(kind, draft);
    return res.json({
      kind,
      subject: preview.subject,
      html: preview.html,
      live: Boolean(parsed.data.draft),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "email_preview_failed", message });
  }
});
