.PHONY: install dev dev-server dev-web db db-stop db-push db-generate db-migrate db-studio setup status stop stop-opencode logs clean

install:
	bun install

dev: db
	@echo "Starting server + web..."
	bun run dev

dev-server: db
	bun run dev:server

dev-web:
	bun run dev:web

db:
	@docker-compose up -d postgres
	@echo "Waiting for PostgreSQL..."
	@until docker exec fourth-spark-db pg_isready -U fourth_spark -q 2>/dev/null; do sleep 0.5; done
	@echo "PostgreSQL ready"

db-stop:
	docker-compose down

db-push:
	cd packages/server && bunx drizzle-kit push

db-generate:
	cd packages/server && bunx drizzle-kit generate

db-migrate:
	cd packages/server && bunx drizzle-kit migrate

db-studio:
	cd packages/server && bunx drizzle-kit studio

setup: install db db-push
	@echo "Setup complete. Run 'make dev' to start."

status:
	@echo "=== PostgreSQL ==="
	@docker exec fourth-spark-db pg_isready -U fourth_spark 2>/dev/null && echo "  running" || echo "  stopped"
	@echo "=== Server ==="
	@curl -s http://127.0.0.1:3000/ 2>/dev/null && echo "" || echo "  stopped"
	@echo "=== Web ==="
	@curl -s -o /dev/null -w "  http://localhost:5173 → %{http_code}\n" http://127.0.0.1:5173/ 2>/dev/null || echo "  stopped"
	@echo "=== OpenCode ==="
	@ps aux | grep 'opencode serve --port' | grep -v grep | while read line; do \
		pid=$$(echo "$$line" | awk '{print $$2}'); \
		port=$$(echo "$$line" | grep -o '\-\-port [0-9]*' | awk '{print $$2}'); \
		echo "  PID $$pid  port $$port"; \
	done

stop:
	@echo "Stopping all services..."
	-@pkill -f 'bun run --watch src/index.ts' 2>/dev/null
	-@pkill -f 'opencode serve --port' 2>/dev/null
	-@rm -f /tmp/fourth-spark/pid-map.json
	docker-compose down
	@echo "All stopped"

stop-opencode:
	@echo "Killing opencode processes (will respawn on next server restart)..."
	-@pkill -f 'opencode serve --port' 2>/dev/null
	-@rm -f /tmp/fourth-spark/pid-map.json
	@echo "Done"

logs:
	@echo "=== Server log (last 20) ==="
	@tail -20 /tmp/fourth-spark/server.log 2>/dev/null || echo "  no log"
	@echo ""
	@for f in /tmp/fourth-spark/opencode-*.log; do \
		echo "=== $$(basename $$f) (last 10) ==="; \
		tail -10 "$$f" 2>/dev/null | grep -v 'duplicate skill'; \
		echo ""; \
	done

clean: stop
	rm -f /tmp/fourth-spark/opencode-*.log /tmp/fourth-spark/server.log /tmp/fourth-spark/api-capture.flow /tmp/fourth-spark/mitmdump.log
	@echo "Logs cleaned"
