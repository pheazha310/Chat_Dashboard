# Chat Dashboard API (Express 5 + ws). Build context: the repo root.
#   docker build -f backend/Dockerfile -t chatdash-api:<tag> .
#   docker build -f backend/Dockerfile --target migrate -t chatdash-migrate:<tag> .
ARG NODE_VERSION=22.23.4
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
RUN --mount=type=cache,id=chatdash-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @chat-dashboard/backend...
COPY backend backend
# prisma.config.ts reads DATABASE_URL even for `generate`; this placeholder never connects anywhere.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @chat-dashboard/backend db:generate \
 && pnpm --filter @chat-dashboard/backend build \
 && pnpm --filter @chat-dashboard/backend deploy --legacy --prod /out

# One-shot job: applies the committed Prisma migrations (never `migrate dev` or `reset`). Needs the Prisma CLI, so it
# is built from the full install, not from the slim runtime image.
FROM build AS migrate
WORKDIR /repo/backend
ENV NODE_ENV=production
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/backend/dist ./dist
# Uploaded files use the local driver only when STORAGE_DRIVER=local; the directory must be writable by `node`.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
