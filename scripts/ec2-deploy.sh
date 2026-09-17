#!/usr/bin/env bash
# Deploy en EC2: git pull + migrate + catálogo + build + PM2.
# Lo invoca GitHub Actions en cada push a main (ver .github/workflows/deploy-ec2.yml).
set -euo pipefail

APP_DIR="${NUTRI_API_PATH:-/opt/nutri-api}"
cd "$APP_DIR"

echo "=== $(date -Is) deploy nutri-api ==="
echo "=== git ==="
git fetch origin
git reset --hard origin/main
git log -1 --oneline

echo "=== npm ci ==="
npm ci

echo "=== db:migrate ==="
npm run db:migrate

echo "=== db:import-catalog ==="
export SKIP_ICBF_IMPORT="${SKIP_ICBF_IMPORT:-0}"
export SKIP_BASE_IMPORT="${SKIP_BASE_IMPORT:-0}"
npm run db:import-catalog

echo "=== build ==="
npm run build

echo "=== pm2 ==="
if pm2 describe nutri-api >/dev/null 2>&1; then
  pm2 restart nutri-api --update-env
else
  pm2 start dist/index.js --name nutri-api --cwd "$APP_DIR"
fi
pm2 save

echo "=== health ==="
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4000}/health" | head -c 500
echo ""
echo "=== deploy OK ==="
