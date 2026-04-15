FROM node:20-bookworm-slim AS build

WORKDIR /app

ENV CI=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=5211 \
  HOME=/data \
  WIKIOS_OPEN_BROWSER=0

LABEL org.opencontainers.image.title="WikiOS"

RUN mkdir -p /app /data \
  && chown -R node:node /app /data

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/sample-vault ./sample-vault

USER node

EXPOSE 5211

CMD ["node", "dist-server/server/server.js"]