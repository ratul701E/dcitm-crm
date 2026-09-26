#!/usr/bin/env bash
# ==============================================================================
# DCITM CRM — Instant Database Backup Helper
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "==> [DCITM CRM] Triggering immediate PostgreSQL backup..."

# Trigger the built-in backup script inside the db-backup container
docker compose exec db-backup /backup.sh

echo ""
echo "==> [DCITM CRM] Backup finished successfully!"
echo "==> Backups are located in: $ROOT_DIR/backups/postgres"
echo ""
ls -lh "$ROOT_DIR/backups/postgres" || true
