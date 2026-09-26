#!/bin/sh
set -e

echo "==> DCITM CRM Backend Container Initializing..."

# Extract host and port from environment variables
DB_HOST=${DB_HOST:-postgres}
DB_PORT=${DB_PORT:-5432}

echo "==> Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT} to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

until node -e "
const net = require('net');
const client = net.connect({ host: process.env.DB_HOST || 'postgres', port: parseInt(process.env.DB_PORT || '5432', 10) }, () => {
  client.end();
  process.exit(0);
});
client.on('error', () => process.exit(1));
" 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "==> ERROR: Timed out waiting for PostgreSQL to become ready."
    exit 1
  fi
  echo "==> PostgreSQL is unavailable - sleeping 2s (attempt $RETRY_COUNT/$MAX_RETRIES)..."
  sleep 2
done

echo "==> PostgreSQL connection established!"

# Synchronize database schema with Prisma
echo "==> Synchronizing Prisma schema with database..."
npx prisma db push --skip-generate

echo "==> Database schema synchronization complete!"

# Execute main process
echo "==> Launching backend application: $@"
exec "$@"
