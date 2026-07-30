import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raíz de archivos subidos (fuera de src). */
export function uploadsRoot(): string {
  return path.resolve(__dirname, "../../uploads");
}

export function labLogoDir(labId: string): string {
  return path.join(uploadsRoot(), "labs", labId);
}

export function labLogoPath(labId: string, ext: string): string {
  return path.join(labLogoDir(labId), `logo.${ext}`);
}

/** URL pública relativa servida por Express. */
export function labLogoPublicPath(labId: string, ext: string | null | undefined): string | null {
  if (!ext) return null;
  return `/uploads/labs/${labId}/logo.${ext}`;
}

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

export function normalizeImageExt(input: string): string | null {
  const ext = input.replace(/^\./, "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ALLOWED_EXT.has(ext) ? (ext === "jpg" ? "jpg" : ext) : null;
}

export function extFromMime(mime: string): string | null {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mime.toLowerCase()] ?? null;
}

export function ensureLabLogoDir(labId: string) {
  fs.mkdirSync(labLogoDir(labId), { recursive: true });
}

export function removeLabLogoFiles(labId: string) {
  const dir = labLogoDir(labId);
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith("logo.")) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}
