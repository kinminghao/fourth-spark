#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.fourth-spark.pid"
LOG_DIR="$DIR/logs"

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "fourth-spark is already running (PID $(cat "$PID_FILE"))"
  echo "Run ./stop.sh first."
  exit 1
fi

# 1. Start PostgreSQL
echo "→ Starting PostgreSQL..."
docker compose -f "$DIR/docker-compose.yml" up -d postgres
echo "  Waiting for PostgreSQL..."
until docker exec fourth-spark-db pg_isready -U fourth_spark -q 2>/dev/null; do
  sleep 0.5
done
echo "  PostgreSQL ready"

# 2. Start server
echo "→ Starting fourth-spark server..."
cd "$DIR"
nohup ./fourth-spark > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 1
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo ""
  echo "=== fourth-spark started ==="
  echo "  PID:  $SERVER_PID"
  echo "  URL:  http://localhost:${PORT:-3000}"
  echo "  Logs: $LOG_DIR/server.log"
  echo ""
  echo "  ./stop.sh  — stop all services"
else
  echo "ERROR: server failed to start. Check $LOG_DIR/server.log"
  rm -f "$PID_FILE"
  exit 1
fi
