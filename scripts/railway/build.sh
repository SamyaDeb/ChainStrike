#!/bin/bash
set -e

if [ -z "$BUILD_FILTER" ]; then
  echo "ERROR: BUILD_FILTER env var is required (e.g. @chainstrike/identity-service)"
  exit 1
fi

echo "Building: $BUILD_FILTER (from monorepo root)"
npx turbo run build --filter="${BUILD_FILTER}..."
