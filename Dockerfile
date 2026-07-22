FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

RUN bun install --frozen-lockfile

COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

EXPOSE 3000 5173
