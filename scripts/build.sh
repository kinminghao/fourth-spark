#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
DIST="$ROOT/dist"

if [ -n "$TARGET" ]; then
  DIST="$ROOT/dist/$TARGET"
fi

echo "=== Building Fourth Spark${TARGET:+ ($TARGET)} ==="

rm -rf "$DIST"
mkdir -p "$DIST"

echo "→ Building web..."
cd "$ROOT/packages/web"
bunx vite build

echo "→ Copying static assets..."
cp -r "$ROOT/packages/web/dist" "$DIST/public"

echo "→ Compiling server${TARGET:+ for $TARGET}..."
cd "$ROOT"
COMPILE_ARGS=(packages/server/src/index.ts --compile --outfile "$DIST/fourth-spark")
if [ -n "$TARGET" ]; then
  COMPILE_ARGS+=(--target "$TARGET")
fi
bun build "${COMPILE_ARGS[@]}"

echo "→ Copying runtime assets..."
cp "$ROOT/docker-compose.yml" "$DIST/"
cp -r "$ROOT/packages/server/drizzle" "$DIST/drizzle"
cp "$ROOT/scripts/start.sh" "$DIST/"
cp "$ROOT/scripts/stop.sh" "$DIST/"
chmod +x "$DIST/start.sh" "$DIST/stop.sh"

echo ""
echo "=== Build complete ==="
echo "Output: $DIST/"
ls -lh "$DIST/"
