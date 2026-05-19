#!/bin/bash
# Usage: bash scripts/render/build-service.sh <service-dir> <turbo-filter>
# Example: bash scripts/render/build-service.sh services/identity @chainstrike/identity-service
set -e

SERVICE_DIR="$1"
TURBO_FILTER="$2"

if [ -z "$SERVICE_DIR" ] || [ -z "$TURBO_FILTER" ]; then
  echo "ERROR: Usage: build-service.sh <service-dir> <turbo-filter>"
  exit 1
fi

echo "=== Installing dependencies ==="
npm ci --include=dev

echo "=== Generating Prisma clients ==="
npx turbo run db:generate

echo "=== Building $TURBO_FILTER ==="
npx turbo run build "--filter=${TURBO_FILTER}..."

# Run migrations if this service has a prisma schema
if [ -f "$SERVICE_DIR/prisma/schema.prisma" ]; then
  echo "=== Running migrations for $SERVICE_DIR ==="
  cd "$SERVICE_DIR"
  npx prisma migrate deploy --schema=prisma/schema.prisma
  cd -
fi

echo "=== Build complete ==="
