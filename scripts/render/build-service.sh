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
# Force devDependencies even though NODE_ENV=production at runtime
NODE_ENV=development npm ci

echo "=== Generating Prisma clients ==="
npx turbo run db:generate --ui=stream

echo "=== Building $TURBO_FILTER ==="
npx turbo run build --filter="${TURBO_FILTER}..." --ui=stream

echo "=== Build complete ==="
