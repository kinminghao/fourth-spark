#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
DIST="$ROOT/dist"

if [ -n "$TARGET" ]; then
  DIST="$ROOT/dist/$TARGET"
fi

# Extract version from git tag (e.g. v0.4.0 → 0.4.0), fallback to commit hash
VERSION="$(git -C "$ROOT" describe --tags --always 2>/dev/null | sed 's/^v//')"
VERSION="${VERSION:-dev}"
export APP_VERSION="$VERSION"

echo "=== Building Fourth Spark ${VERSION}${TARGET:+ ($TARGET)} ==="

rm -rf "$DIST"
mkdir -p "$DIST"

echo "→ Building web (version: $VERSION)..."
cd "$ROOT/packages/web"
APP_VERSION="$VERSION" bunx vite build

echo "→ Copying static assets..."
cp -r "$ROOT/packages/web/dist" "$DIST/public"

echo "→ Compiling server${TARGET:+ for $TARGET}..."
cd "$ROOT"
COMPILE_ARGS=(packages/server/src/cli.ts --compile --outfile "$DIST/fourth-spark")
COMPILE_ARGS+=(--define "process.env.APP_VERSION=\"$VERSION\"")
if [ -n "$TARGET" ]; then
  COMPILE_ARGS+=(--target "$TARGET")
fi
bun build "${COMPILE_ARGS[@]}"

echo "→ Generating latest DB migrations..."
cd "$ROOT/packages/server"
bunx drizzle-kit generate

echo "→ Copying runtime assets..."
cp "$ROOT/docker-compose.yml" "$DIST/"
cp -r "$ROOT/packages/server/drizzle" "$DIST/drizzle"

echo ""
echo "=== Build complete ==="
echo "Output: $DIST/"
ls -lh "$DIST/"

if [ -z "$TARGET" ]; then
  echo ""
  echo "→ Assembling npm package..."
  NPM_DIST="$ROOT/dist/npm"
  rm -rf "$NPM_DIST"
  mkdir -p "$NPM_DIST/bin"
  cp "$ROOT/npm/package.json" "$NPM_DIST/"
  cp "$ROOT/npm/postinstall.js" "$NPM_DIST/"
  cp "$ROOT/npm/cli.js" "$NPM_DIST/bin/"
  chmod +x "$NPM_DIST/bin/cli.js"
  sed -i.bak "s/\"0.0.0\"/\"$VERSION\"/" "$NPM_DIST/package.json" && rm -f "$NPM_DIST/package.json.bak"
  cp -r "$DIST/public" "$NPM_DIST/public"
  cp -r "$DIST/drizzle" "$NPM_DIST/drizzle"
  cp "$ROOT/docker-compose.yml" "$NPM_DIST/"
  echo "npm package: $NPM_DIST/"
  ls -lh "$NPM_DIST/"
fi
