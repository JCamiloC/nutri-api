import { getPool } from "../db/pool.js";
import { env } from "../config/env.js";
import { platformLogoPublicPath } from "./uploads.js";

export type PlatformBranding = {
  productName: string;
  companyName: string;
  tagline: string;
  supportEmail: string | null;
  logoExt: string | null;
  logoUrl: string | null;
  logoAbsoluteUrl: string | null;
  inkColor: string;
  accentColor: string;
  pageColor: string;
  emailFromName: string;
  emailFooter: string | null;
  welcomeIntro: string | null;
  mfaIntro: string | null;
  inviteIntro: string | null;
  resetIntro: string | null;
  updatedAt: string | null;
};

export type PlatformBrandingDraft = Partial<
  Pick<
    PlatformBranding,
    | "productName"
    | "companyName"
    | "tagline"
    | "supportEmail"
    | "inkColor"
    | "accentColor"
    | "pageColor"
    | "emailFromName"
    | "emailFooter"
    | "welcomeIntro"
    | "mfaIntro"
    | "inviteIntro"
    | "resetIntro"
  >
>;

const DEFAULTS: Omit<PlatformBranding, "logoUrl" | "logoAbsoluteUrl" | "logoExt" | "updatedAt"> = {
  productName: "NutriLab",
  companyName: "Enerxis",
  tagline: "Tablas nutricionales listas para etiquetar",
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
  inkColor: "#13344c",
  accentColor: "#1f88a4",
  pageColor: "#eef4f9",
  emailFromName: "NutriLab",
  emailFooter: null,
  welcomeIntro: null,
};

export function apiPublicUrl(): string {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `http://127.0.0.1:${env.port}`;
}

function colorOr(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

export function mapPlatformRow(row: Record<string, unknown> | undefined): PlatformBranding {
  const productName = String(row?.product_name ?? DEFAULTS.productName);
  const companyName = String(row?.company_name ?? DEFAULTS.companyName);
  const logoExt = (row?.logo_ext as string | null) ?? null;
  const rel = platformLogoPublicPath(logoExt);
  const updatedAt =
    row?.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row?.updated_at
        ? String(row.updated_at)
        : null;
  const bust = updatedAt ? `?v=${Date.parse(updatedAt) || Date.now()}` : "";
  const logoUrl = rel ? `${rel}${bust}` : null;
  const logoAbsoluteUrl = rel ? `${apiPublicUrl()}${rel}${bust}` : null;
  const emailFromName =
    String(row?.email_from_name ?? "").trim() || productName || DEFAULTS.emailFromName;

  return {
    productName,
    companyName,
    tagline: String(row?.tagline ?? DEFAULTS.tagline),
    supportEmail:
      String(row?.support_email ?? "").trim() ||
      process.env.SUPPORT_EMAIL?.trim() ||
      null,
    logoExt,
    logoUrl,
    logoAbsoluteUrl,
    inkColor: colorOr(row?.ink_color, DEFAULTS.inkColor),
    accentColor: colorOr(row?.accent_color, DEFAULTS.accentColor),
    pageColor: colorOr(row?.page_color, DEFAULTS.pageColor),
    emailFromName,
    emailFooter: String(row?.email_footer ?? "").trim() || null,
    welcomeIntro: String(row?.welcome_intro ?? "").trim() || null,
    mfaIntro: String(row?.mfa_intro ?? "").trim() || null,
    inviteIntro: String(row?.invite_intro ?? "").trim() || null,
    resetIntro: String(row?.reset_intro ?? "").trim() || null,
    updatedAt,
  };
}

/** Vista previa en vivo (borrador sin guardar). */
export function mergePlatformBrandingDraft(
  base: PlatformBranding,
  draft?: PlatformBrandingDraft,
): PlatformBranding {
  if (!draft) return base;
  return {
    ...base,
    productName: draft.productName?.trim() || base.productName,
    companyName: draft.companyName?.trim() || base.companyName,
    tagline: draft.tagline?.trim() ?? base.tagline,
    supportEmail:
      draft.supportEmail === undefined
        ? base.supportEmail
        : draft.supportEmail?.trim() || null,
    inkColor: draft.inkColor ?? base.inkColor,
    accentColor: draft.accentColor ?? base.accentColor,
    pageColor: draft.pageColor ?? base.pageColor,
    emailFromName: draft.emailFromName?.trim() || base.emailFromName,
    emailFooter:
      draft.emailFooter === undefined
        ? base.emailFooter
        : draft.emailFooter?.trim() || null,
    welcomeIntro:
      draft.welcomeIntro === undefined
        ? base.welcomeIntro
        : draft.welcomeIntro?.trim() || null,
    mfaIntro:
      draft.mfaIntro === undefined ? base.mfaIntro : draft.mfaIntro?.trim() || null,
    inviteIntro:
      draft.inviteIntro === undefined
        ? base.inviteIntro
        : draft.inviteIntro?.trim() || null,
    resetIntro:
      draft.resetIntro === undefined
        ? base.resetIntro
        : draft.resetIntro?.trim() || null,
  };
}

export async function loadPlatformBranding(): Promise<PlatformBranding> {
  try {
    const result = await getPool().query(
      `SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`,
    );
    if (!result.rows[0]) {
      await getPool().query(`INSERT INTO platform_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`);
      return mapPlatformRow(undefined);
    }
    return mapPlatformRow(result.rows[0]);
  } catch {
    return mapPlatformRow(undefined);
  }
}

export function publicBrandingPayload(b: PlatformBranding) {
  return {
    productName: b.productName,
    companyName: b.companyName,
    tagline: b.tagline,
    logoUrl: b.logoAbsoluteUrl,
    inkColor: b.inkColor,
    accentColor: b.accentColor,
  };
}
