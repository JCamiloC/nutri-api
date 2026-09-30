import type { Pool, PoolClient } from "pg";

export type ManufacturerProfileRow = {
  id: string;
  lab_id: string;
  label: string;
  manufactured_by: string;
  manufactured_for: string;
  is_default: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

export function mapManufacturerProfile(row: ManufacturerProfileRow) {
  return {
    id: row.id,
    labId: row.lab_id,
    label: row.label,
    manufacturedBy: row.manufactured_by,
    manufacturedFor: row.manufactured_for,
    isDefault: row.is_default === true,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type Db = Pool | PoolClient;

export async function listManufacturerProfiles(db: Db, labId: string) {
  const result = await db.query<ManufacturerProfileRow>(
    `SELECT * FROM lab_manufacturer_profiles
     WHERE lab_id = $1
     ORDER BY is_default DESC, sort_order ASC, created_at ASC`,
    [labId],
  );
  return result.rows.map(mapManufacturerProfile);
}

export async function getDefaultManufacturerProfile(db: Db, labId: string) {
  const result = await db.query<ManufacturerProfileRow>(
    `SELECT * FROM lab_manufacturer_profiles
     WHERE lab_id = $1
     ORDER BY is_default DESC, sort_order ASC, created_at ASC
     LIMIT 1`,
    [labId],
  );
  return result.rows[0] ? mapManufacturerProfile(result.rows[0]) : null;
}

export async function clearDefaultManufacturerProfiles(db: Db, labId: string) {
  await db.query(
    `UPDATE lab_manufacturer_profiles SET is_default = false, updated_at = now()
     WHERE lab_id = $1 AND is_default = true`,
    [labId],
  );
}
