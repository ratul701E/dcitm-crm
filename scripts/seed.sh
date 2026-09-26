#!/usr/bin/env bash
# ==============================================================================
# DCITM CRM — Database Seed Helper
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "==> [DCITM CRM] Executing database seed inside backend container..."

docker compose exec backend node prisma/seed.js

echo ""
echo "==> [DCITM CRM] Seed completed successfully!"
