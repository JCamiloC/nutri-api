import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import {
  ensureLibraryDir,
  libraryFilePath,
  safeUnlink,
} from "../lib/uploads.js";
import { requireAuth, requireSuperadmin } from "../middleware/auth.js";

export const libraryRouter = Router();

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function mapDoc(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    originalName: String(row.original_name),
    mime: String(row.mime ?? "application/pdf"),
    byteSize: Number(row.byte_size ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePdfDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:(application\/pdf);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

libraryRouter.get("/v1/library/documents", requireAuth, async (_req, res) => {
  try {
    const result = await getPool().query(
      `SELECT * FROM library_documents ORDER BY sort_order ASC, created_at DESC`,
    );
    return res.json({ items: result.rows.map(mapDoc) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_library_failed", message });
  }
});

libraryRouter.get("/v1/library/documents/:id/file", requireAuth, async (req, res) => {
  try {
    const result = await getPool().query(`SELECT * FROM library_documents WHERE id = $1`, [
      req.params.id,
    ]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "not_found" });
    const filePath = libraryFilePath(String(row.stored_name));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file_missing", message: "El archivo ya no está en disco" });
    }
    res.setHeader("Content-Type", String(row.mime || "application/pdf"));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(String(row.original_name || "documento.pdf"))}"`,
    );
    return res.sendFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "get_library_file_failed", message });
  }
});

const createBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  originalName: z.string().min(1).max(260).optional(),
  dataUrl: z.string().min(32),
});

libraryRouter.post(
  "/v1/library/documents",
  requireAuth,
  requireSuperadmin,
  async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const buffer = parsePdfDataUrl(parsed.data.dataUrl);
    if (!buffer) {
      return res.status(400).json({
        error: "invalid_pdf",
        message: "Se espera un PDF en data URL (application/pdf)",
      });
    }
    if (buffer.length < 32 || buffer.length > MAX_PDF_BYTES) {
      return res.status(400).json({
        error: "invalid_size",
        message: "El PDF debe pesar entre 32 B y 20 MB",
      });
    }

    const id = randomUUID();
    const storedName = `${id}.pdf`;
    const originalName =
      parsed.data.originalName?.replace(/[\\/:*?"<>|]+/g, "-") || "documento.pdf";

    try {
      ensureLibraryDir();
      fs.writeFileSync(libraryFilePath(storedName), buffer);
      const maxSort = await getPool().query<{ n: number }>(
        `SELECT COALESCE(MAX(sort_order), 0)::int AS n FROM library_documents`,
      );
      const result = await getPool().query(
        `INSERT INTO library_documents (
          id, title, description, original_name, stored_name, mime, byte_size,
          sort_order, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,$8)
        RETURNING *`,
        [
          id,
          parsed.data.title.trim(),
          parsed.data.description?.trim() || null,
          originalName.endsWith(".pdf") ? originalName : `${originalName}.pdf`,
          storedName,
          buffer.length,
          (maxSort.rows[0]?.n ?? 0) + 1,
          req.user?.id ?? null,
        ],
      );
      await writeAudit(req, {
        action: "library.upload",
        detail: parsed.data.title.trim(),
      });
      return res.status(201).json(mapDoc(result.rows[0]));
    } catch (error) {
      safeUnlink(libraryFilePath(storedName));
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "upload_library_failed", message });
    }
  },
);

const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  dataUrl: z.string().min(32).optional(),
  originalName: z.string().min(1).max(260).optional(),
});

libraryRouter.patch(
  "/v1/library/documents/:id",
  requireAuth,
  requireSuperadmin,
  async (req, res) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      const existing = await getPool().query(`SELECT * FROM library_documents WHERE id = $1`, [
        req.params.id,
      ]);
      const row = existing.rows[0];
      if (!row) return res.status(404).json({ error: "not_found" });

      let storedName = String(row.stored_name);
      let byteSize = Number(row.byte_size);
      let originalName = String(row.original_name);
      const d = parsed.data;

      if (d.dataUrl) {
        const buffer = parsePdfDataUrl(d.dataUrl);
        if (!buffer) {
          return res.status(400).json({
            error: "invalid_pdf",
            message: "Se espera un PDF en data URL (application/pdf)",
          });
        }
        if (buffer.length < 32 || buffer.length > MAX_PDF_BYTES) {
          return res.status(400).json({
            error: "invalid_size",
            message: "El PDF debe pesar entre 32 B y 20 MB",
          });
        }
        ensureLibraryDir();
        fs.writeFileSync(libraryFilePath(storedName), buffer);
        byteSize = buffer.length;
        if (d.originalName) {
          originalName = d.originalName.replace(/[\\/:*?"<>|]+/g, "-");
          if (!originalName.toLowerCase().endsWith(".pdf")) originalName += ".pdf";
        }
      }

      const result = await getPool().query(
        `UPDATE library_documents SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          original_name = COALESCE($4, original_name),
          byte_size = COALESCE($5, byte_size),
          sort_order = COALESCE($6, sort_order),
          updated_at = now()
        WHERE id = $1
        RETURNING *`,
        [
          req.params.id,
          d.title?.trim() ?? null,
          d.description === undefined ? null : d.description?.trim() || null,
          d.dataUrl ? originalName : null,
          d.dataUrl ? byteSize : null,
          d.sortOrder ?? null,
        ],
      );

      await writeAudit(req, {
        action: "library.update",
        detail: String(result.rows[0].title),
      });
      return res.json(mapDoc(result.rows[0]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "update_library_failed", message });
    }
  },
);

libraryRouter.delete(
  "/v1/library/documents/:id",
  requireAuth,
  requireSuperadmin,
  async (req, res) => {
    try {
      const existing = await getPool().query(`SELECT * FROM library_documents WHERE id = $1`, [
        req.params.id,
      ]);
      const row = existing.rows[0];
      if (!row) return res.status(404).json({ error: "not_found" });
      await getPool().query(`DELETE FROM library_documents WHERE id = $1`, [req.params.id]);
      safeUnlink(libraryFilePath(String(row.stored_name)));
      await writeAudit(req, {
        action: "library.delete",
        detail: String(row.title),
      });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "delete_library_failed", message });
    }
  },
);
