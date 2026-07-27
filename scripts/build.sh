#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

echo "=== Building Fourth Spark ==="

# Clean previous build
rm -rf "$DIST"
mkdir -p "$DIST"

# 1. Build web frontend
echo "→ Building web..."
cd "$ROOT/packages/web"
bunx vite build

# 2. Copy static assets to dist/public
echo "→ Copying static assets..."
cp -r "$ROOT/packages/web/dist" "$DIST/public"

# 3. Compile server binary
echo "→ Compiling server..."
cd "$ROOT"
bun build packages/server/src/index.ts \
  --compile \
  --outfile "$DIST/fourth-spark"

# 4. Copy runtime assets
echo "→ Copying runtime assets..."
cp "$ROOT/docker-compose.yml" "$DIST/"
cp -r "$ROOT/packages/server/drizzle" "$DIST/drizzle"
cp "$ROOT/scripts/start.sh" "$DIST/"
cp "$ROOT/scripts/stop.sh" "$DIST/"
chmod +x "$DIST/start.sh" "$DIST/stop.sh"

echo ""
echo "=== Build complete ==="
echo "Output: $DIST/"
echo ""
echo "Contents:"
ls -lh "$DIST/"
echo ""
echo "To run:"
echo "  cd dist && ./start.sh"
