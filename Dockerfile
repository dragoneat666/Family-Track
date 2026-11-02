# 1. Build the web app (the same files that go into the Android app).
FROM node:24-slim AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

# 2. The server, which also serves the web app for testing in a browser.
FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /app/dist ./public
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 8080
VOLUME /data
CMD ["node", "src/index.js"]
