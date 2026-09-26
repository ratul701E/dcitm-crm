#!/bin/sh
set -e

echo "==> DCITM CRM Backend Container Initializing..."

# Synchronize database schema directly using Prisma
echo "==> Synchronizing Prisma schema with PostgreSQL database..."
MAX_RETRIES=5
RETRY_COUNT=0

until npx prisma db push --skip-generate; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "==> ERROR: Could not synchronize Prisma schema with database after $MAX_RETRIES attempts."
    exit 1
  fi
  echo "==> Database connection not ready yet. Retrying in 3s (attempt $RETRY_COUNT/$MAX_RETRIES)..."
  sleep 3
done

echo "==> Database schema synchronization complete!"

# Execute main process
echo "==> Launching backend application: $@"
exec "$@"
