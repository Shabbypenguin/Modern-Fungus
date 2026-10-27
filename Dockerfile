# Fungus: one small Node process serves the built game and the /ws game server.
#   docker build -t fungus:local .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
RUN npm test && npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 TRUST_PROXY=1
WORKDIR /app
# The server is a single bundled file; the client is static files next to it.
COPY --from=build --chown=node:node /app/packages/server/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/packages/client/dist ./public
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz > /dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
