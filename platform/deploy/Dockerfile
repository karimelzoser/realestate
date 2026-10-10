# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS workspace
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
WORKDIR /srv/preneura

COPY platform/package.json platform/pnpm-lock.yaml platform/pnpm-workspace.yaml ./
COPY platform/apps/api/package.json apps/api/package.json
COPY platform/apps/web/package.json apps/web/package.json
COPY platform/apps/worker/package.json apps/worker/package.json
COPY platform/apps/notification-gateway/package.json apps/notification-gateway/package.json
COPY platform/packages/contracts/package.json packages/contracts/package.json
COPY platform/packages/database/package.json packages/database/package.json
COPY platform/packages/observability/package.json packages/observability/package.json
COPY platform/packages/security/package.json packages/security/package.json
RUN pnpm install --frozen-lockfile

COPY platform/ ./
ARG NEXT_PUBLIC_API_URL
ARG PRENEURA_SOURCE_SHA
ARG PRENEURA_APPLICATION_RUNTIME_SHA
RUN printf '%s' "${PRENEURA_SOURCE_SHA}" | grep -Eq '^[0-9a-f]{40}$' \
 && printf '%s' "${PRENEURA_APPLICATION_RUNTIME_SHA}" | grep -Eq '^[0-9a-f]{40}$'
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG GITHUB_ACTIONS=false
ENV GITHUB_ACTIONS=${GITHUB_ACTIONS}
RUN pnpm --filter @preneura/api... build \
 && pnpm --filter @preneura/worker... build \
 && pnpm --filter @preneura/notification-gateway... build \
 && pnpm --filter @preneura/web... build

FROM workspace AS runtime-base
ARG PRENEURA_SOURCE_SHA
ARG PRENEURA_APPLICATION_RUNTIME_SHA
LABEL org.opencontainers.image.source="https://github.com/karimelzoser/realestate" \
      org.opencontainers.image.revision="${PRENEURA_SOURCE_SHA}" \
      com.preneura.application-runtime-sha="${PRENEURA_APPLICATION_RUNTIME_SHA}" \
      com.preneura.runtime-schema-version="41"
ENV NODE_ENV=production
ENV GITHUB_ACTIONS=false
RUN chown -R node:node /srv/preneura
USER node

FROM runtime-base AS api
WORKDIR /srv/preneura/apps/api
EXPOSE 4100
CMD ["node", "--import", "@preneura/observability/register", "dist/main.js"]

FROM runtime-base AS worker
WORKDIR /srv/preneura/apps/worker
CMD ["node", "--import", "@preneura/observability/register", "dist/main.js"]

FROM runtime-base AS notification-gateway
WORKDIR /srv/preneura/apps/notification-gateway
EXPOSE 4300
CMD ["node", "--import", "@preneura/observability/register", "dist/bootstrap.js"]

FROM runtime-base AS web
WORKDIR /srv/preneura/apps/web
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p ${PORT:-3000}"]

FROM runtime-base AS migrate
WORKDIR /srv/preneura/packages/database
ENTRYPOINT ["sh", "-c", "node scripts/wait-for-database.mjs && exec node scripts/migrate.mjs"]
