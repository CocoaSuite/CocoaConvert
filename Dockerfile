# CocoaConvert: the web app plus the optional conversion server, with every server tool installed.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build && npx vite build --config vite.server.config.ts && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      pandoc ffmpeg xz-utils bzip2 tar util-linux \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 cocoa
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/package.json ./
USER cocoa
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist WORK_DIR=/tmp/cocoaconvert-jobs
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
