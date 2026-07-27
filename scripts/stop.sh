#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.fourth-spark.pid"

# 1. Stop server
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "→ Stopping fourth-spark server (PID $PID)..."
    kill "$PID"
    # Wait up to 5s for graceful shutdown
    for _ in $(seq 1 10); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.5
    done
    # Force kill if still alive
    if kill -0 "$PID" 2>/dev/null; then
      echo "  Force killing..."
      kill -9 "$PID" 2>/dev/null || true
    fi
    echo "  Server stopped"
  else
    echo "  Server not running (stale PID file)"
  fi
  rm -f "$PID_FILE"
else
  echo "  No PID file found — server not managed by start.sh"
fi

# 2. Stop opencode processes spawned by server
if pgrep -f 'opencode serve --port' >/dev/null 2>&1; then
  echo "→ Stopping opencode processes..."
  pkill -f 'opencode serve --port' 2>/dev/null || true
  echo "  Done"
fi

# 3. Stop PostgreSQL
echo "→ Stopping PostgreSQL..."
docker compose -f "$DIR/docker-compose.yml" down

echo ""
echo "=== All services stopped ==="
