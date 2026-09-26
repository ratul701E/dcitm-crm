#!/usr/bin/env bash
# ==============================================================================
# DCITM CRM — Database Restore Helper
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$ROOT_DIR/backups/postgres"

cd "$ROOT_DIR"

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "==> No backup file specified. Looking for the latest backup in $BACKUP_DIR..."
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n 1 || true)
  if [ -z "$BACKUP_FILE" ]; then
    echo "ERROR: No .sql.gz backup files found in $BACKUP_DIR."
    echo "Usage: ./scripts/restore.sh <path-to-backup.sql.gz>"
    exit 1
  fi
fi

echo "======================================================================"
echo "WARNING: Restoring will overwrite existing data in the database!"
echo "Target Backup: $BACKUP_FILE"
echo "======================================================================"
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo "==> Decompressing and restoring database..."
BACKUP_FILENAME=$(basename "$BACKUP_FILE")
docker compose exec -T db-backup sh -c "gunzip -c '/backups/$BACKUP_FILENAME' | psql -h postgres -U \$POSTGRES_USER -d \$POSTGRES_DB"

echo "==> [DCITM CRM] Database successfully restored from: $BACKUP_FILE"
