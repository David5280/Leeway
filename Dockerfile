# Leeway in one image: the API server, the built web app and the database migrations.
# Build:  docker build -t leeway .
# Run:    docker compose up   (see docker-compose.yml)

# Stage 1: install everything and build the web app and server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY server server
COPY web web
RUN npm run build

# Stage 2: production dependencies only, so the image carries no build tools.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

# Stage 3: the image that runs. The server finds web/dist and server/migrations
# by walking up from its own folder, so this layout mirrors the repository.
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/dist/src/index.js"]
