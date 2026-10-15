ARG NODE_BUILDER_VERSION=22-slim
ARG NODE_RUNTIME_VERSION=22-alpine

FROM node:${NODE_BUILDER_VERSION} AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY CHANGELOG.md ./
COPY src ./src
COPY public ./public

RUN npm run build


FROM node:${NODE_RUNTIME_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8765

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./index.html
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
 && mkdir -p /home/node/.gitdeck \
 && chown -R node:node /home/node/.gitdeck /app

USER root

EXPOSE 8765
VOLUME ["/home/node/.gitdeck"]

ENTRYPOINT ["./docker-entrypoint.sh"]
