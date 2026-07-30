import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { resolveLabId } from "../lib/mappers.js";
import { getLabCapacity } from "../lib/quota.js";
import {
  ensureLabLogoDir,
  extFromMime,
  labLogoPath,
  labLogoPublicPath,
  normalizeImageExt,
  removeLabLogoFiles,
} from "../lib/uploads.js";
import { requireAuth, requireWrite } from "../middleware/auth.js";

export const labRouter = Router();

function getLabId(
  req: Parameters<typeof resolveLabId>[0],
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
) {
  try {
    return resolveLabId(req);
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string };
    res.status(err.status ?? 403).json({
      error: err.code ?? "lab_required",
      message: err.message ?? "Laboratorio requerido",
    });
    return null;
  }
}

function mapLab(row: Record<string, unknown>, absoluteBase?: string) {
  const id = String(row.id);
  const logoExt = (row.logo_ext as string | null) ?? null;
  const logoPath = labLogoPublicPath(id, logoExt);
  return {
    id,
    name: row.name,
    status: row.status,
    planId: row.plan_id,
    tablesExtra: Number(row.tables_extra ?? 0),
    city: row.city,
    renewsAt: row.renews_at
      ? row.renews_at instanceof Date
        ? row.renews_at.toISOString().slice(0, 10)
        : String(row.renews_at).slice(0, 10)
      : null,
    logoExt,
    logoUrl: logoPath
      ? absoluteBase
        ? `${absoluteBase.replace(/\/$/, "")}${logoPath}`
        : logoPath
      : null,
    watermarkDefault: row.watermark_default !== false,
    manufacturedByDefault: row.manufactured_by_default ?? null,
    manufacturedForDefault: row.manufactured_for_default ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requestBase(req: { protocol: string; get: (h: string) => string | undefined }) {
  const host = req.get("host");
  if (!host) return undefined;
  return `${req.protocol}://${host}`;
}

labRouter.get("/v1/lab", requireAuth, async (req, res) => {
  try {
    const labId = getLabId(req, res);
    if (!labId) return;
    const result = await getPool().query(`SELECT * FROM labs WHERE id = $1`, [labId]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    const capacity = await getLabCapacity(labId);
    return res.json({
      ...mapLab(result.rows[0], requestBase(req)),
      capacity,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_lab_failed", message });
  }
});

const patchBody = z.object({
  name: z.string().min(1).optional(),
  city: z.string().optional().nullable(),
  watermarkDefault: z.boolean().optional(),
  manufacturedByDefault: z.string().optional().nullable(),
  manufacturedForDefault: z.string().optional().nullable(),
});

labRouter.patch("/v1/lab", requireAuth, requireWrite, async (req, res) => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

  const d = parsed.data;
  try {
    const result = await getPool().query(
      `UPDATE labs SET
        name = COALESCE($2, name),
        city = COALESCE($3, city),
        watermark_default = COALESCE($4, watermark_default),
        manufactured_by_default = COALESCE($5, manufactured_by_default),
        manufactured_for_default = COALESCE($6, manufactured_for_default),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [
        labId,
        d.name ?? null,
        d.city === undefined ? null : d.city,
        d.watermarkDefault ?? null,
        d.manufacturedByDefault === undefined ? null : d.manufacturedByDefault,
        d.manufacturedForDefault === undefined ? null : d.manufacturedForDefault,
      ],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }

    await writeAudit(req, {
      labId,
      action: "lab.update_branding",
      detail: String(result.rows[0].name),
    });

    return res.json(mapLab(result.rows[0], requestBase(req)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_lab_failed", message });
  }
});

const logoBody = z.object({
  /** data:image/png;base64,... */
  dataUrl: z.string().min(32).max(3_500_000),
});

labRouter.post("/v1/lab/logo", requireAuth, requireWrite, async (req, res) => {
  const parsed = logoBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const labId = getLabId(req, res);
  if (!labId) return;

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

    ensureLabLogoDir(labId);
    removeLabLogoFiles(labId);
    fs.writeFileSync(labLogoPath(labId, ext), buffer);

    const result = await getPool().query(
      `UPDATE labs SET logo_ext = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [labId, ext],
    );

    await writeAudit(req, {
      labId,
      action: "lab.upload_logo",
      detail: `logo.${ext} (${buffer.length} bytes)`,
    });

    return res.json(mapLab(result.rows[0], requestBase(req)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "upload_logo_failed", message });
  }
});

labRouter.delete("/v1/lab/logo", requireAuth, requireWrite, async (req, res) => {
  const labId = getLabId(req, res);
  if (!labId) return;

  try {
    removeLabLogoFiles(labId);
    const result = await getPool().query(
      `UPDATE labs SET logo_ext = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [labId],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }
    await writeAudit(req, { labId, action: "lab.delete_logo", detail: "Logo eliminado" });
    return res.json(mapLab(result.rows[0], requestBase(req)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "delete_logo_failed", message });
  }
});
