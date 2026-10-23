import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { labLogoDir, labLogoPath, labLogoPublicPath, safeUnlink } from "./uploads.js";

export const LOGO_PRINT_FILENAME = "logo-print.png";

export function labLogoPrintPath(labId: string): string {
  return path.join(labLogoDir(labId), LOGO_PRINT_FILENAME);
}

export function labLogoPrintPublicPath(labId: string): string {
  return `/uploads/labs/${labId}/${LOGO_PRINT_FILENAME}`;
}

/** URL para rotulado/PDF: PNG rasterizado si existe; si no, el logo principal. */
export function labLogoLabelPublicPath(
  labId: string,
  ext: string | null | undefined,
): string | null {
  const printFile = labLogoPrintPath(labId);
  if (fs.existsSync(printFile)) {
    return labLogoPrintPublicPath(labId);
  }
  return labLogoPublicPath(labId, ext);
}

export function removeLabLogoPrintFile(labId: string) {
  safeUnlink(labLogoPrintPath(labId));
}

/**
 * Genera logo-print.png desde logo.svg (html2canvas no pinta texto SVG).
 * Idempotente; no falla el upload si sharp no puede rasterizar.
 */
export async function ensureLabLogoPrintPng(
  labId: string,
  ext: string | null | undefined,
): Promise<boolean> {
  if (ext !== "svg") {
    removeLabLogoPrintFile(labId);
    return false;
  }
  const svgPath = labLogoPath(labId, "svg");
  if (!fs.existsSync(svgPath)) {
    removeLabLogoPrintFile(labId);
    return false;
  }
  const out = labLogoPrintPath(labId);
  try {
    await sharp(svgPath, { density: 220 })
      .resize(640, 160, { fit: "inside", withoutEnlargement: false })
      .png({ compressionLevel: 9 })
      .toFile(out);
    return fs.existsSync(out);
  } catch {
    safeUnlink(out);
    return false;
  }
}
