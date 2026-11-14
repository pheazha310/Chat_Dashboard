# Chat Dashboard web (React 19 + Vite), served by Nginx. Build context: the repo root.
#   docker build -f frontend/Dockerfile -t chatdash-web:<tag> \
#     --build-arg VITE_WS_URL=wss://<host>/ws --build-arg VITE_API_URL=https://<host>/api/v1/admin \
#     --build-arg VITE_LOS_WEB_ORIGIN=https://<los web origin> .
# Vite inlines VITE_* at build time, so each environment gets its own image. Nothing secret may go in these.
ARG NODE_VERSION=22.23.4
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN --mount=type=cache,id=chatdash-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @chat-dashboard/frontend...
COPY frontend frontend
ARG VITE_WS_URL
ARG VITE_API_URL
ARG VITE_LOS_WEB_ORIGIN
ENV VITE_WS_URL=$VITE_WS_URL VITE_API_URL=$VITE_API_URL VITE_LOS_WEB_ORIGIN=$VITE_LOS_WEB_ORIGIN
RUN pnpm --filter @chat-dashboard/frontend build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# The image's entrypoint renders /etc/nginx/templates/*.template with envsubst at start (LOS_WEB_ORIGIN, CHAT_WS_ORIGIN).
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
ENV NGINX_ENVSUBST_FILTER="^(LOS_WEB_ORIGIN|CHAT_WS_ORIGIN)$"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
