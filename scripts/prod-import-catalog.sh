#!/usr/bin/env bash
# Ejecutar EN EL VPS (después de ssh VPSFidare), no en Windows local.
set -euo pipefail

API_PATH="${NUTRI_API_PATH:-/var/www/html/nutri-api}"
cd "$API_PATH"

echo "[prod] git pull"
git fetch origin
git reset --hard origin/main
git log -1 --oneline

echo "[prod] npm ci"
npm ci

echo "[prod] migrate"
npm run db:migrate

echo "[prod] import catalog (Excel → BD)"
npm run db:import-catalog

DB_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
echo "[prod] base Enerxis:"
psql "$DB_URL" -c "SELECT count(*) AS n FROM ingredients WHERE is_base = true;"
echo "[prod] ICBF:"
psql "$DB_URL" -c "SELECT count(*) AS n FROM icbf_foods;"
echo "[prod] done"
