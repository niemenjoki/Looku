# Looku: one image, two processes (receiver and dashboard), chosen by the
# command: `ingest` or `serve`. Data lives in /data (LOOKU_DB).
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools only for the case that better-sqlite3 has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/next/package.json packages/next/
COPY packages/browser/package.json packages/browser/
COPY packages/node/package.json packages/node/
RUN npm ci --omit=dev --no-audit --no-fund
COPY packages/engine packages/engine
COPY packages/ui packages/ui

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    LOOKU_DB=/data/looku.db \
    LOOKU_INGEST_HOST=0.0.0.0 \
    LOOKU_API_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/engine packages/engine
COPY --from=build /app/packages/ui packages/ui
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787 8788
ENTRYPOINT ["node", "packages/engine/src/cli.js"]
CMD ["serve"]
