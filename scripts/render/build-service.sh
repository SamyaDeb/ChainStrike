#!/bin/bash
# Usage: bash scripts/render/build-service.sh <service-dir> <turbo-filter>
# Example: bash scripts/render/build-service.sh services/identity @chainstrike/identity-service
set -ex

SERVICE_DIR="$1"
TURBO_FILTER="$2"

if [ -z "$SERVICE_DIR" ] || [ -z "$TURBO_FILTER" ]; then
  echo "ERROR: Usage: build-service.sh <service-dir> <turbo-filter>"
  exit 1
fi

echo "=== Environment ==="
echo "NODE_ENV: $NODE_ENV"
echo "Node: $(node --version)"
echo "NPM: $(npm --version)"

echo "=== Installing dependencies (including devDeps) ==="
# Unset NODE_ENV during install so devDependencies are always installed
NODE_ENV=development npm ci

echo "=== Generating Prisma clients ==="
npx turbo run db:generate --ui=stream

echo "=== Building $TURBO_FILTER ==="
npx turbo run build --filter="${TURBO_FILTER}..." --ui=stream

# Run migrations if this service has a prisma schema
if [ -f "$SERVICE_DIR/prisma/schema.prisma" ]; then
  echo "=== Running migrations for $SERVICE_DIR ==="
  cd "$SERVICE_DIR"
  npx prisma migrate deploy --schema=prisma/schema.prisma
  cd -
fi

echo "=== Build complete ==="
