# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for apps/web (Next.js 15).
#   target=dev   → bind-mount source, `next dev` with Fast Refresh
#   target=prod  → standalone production build, `next start`
#
# Build context MUST be the repository root so the monorepo workspace files
# (pnpm-workspace.yaml, root package.json, packages/*) are visible.

ARG NODE_VERSION=20.18-alpine

# ---------- base: pnpm via corepack ----------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---------- deps: install workspace dependencies ----------
FROM base AS deps
# Manifests for the web app + its workspace deps. `@platform/web` consumes
# `@platform/sector-service` for the `AppRouter` type, sector-service in
# turn depends on `@platform/db`, and shared components live in
# `@platform/ui` — so pnpm needs to see all four manifests to resolve
# the workspace graph.
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/sector-service/package.json ./services/sector-service/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/ui/package.json ./packages/ui/package.json
# Lockfile may not exist yet during Phase 0 — fall back to a non-frozen install.
COPY pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --filter @platform/web...; \
    else \
      pnpm install --filter @platform/web...; \
    fi
# `@platform/sector-service`'s package entry is ./src/index.ts, so TS needs
# its source (transitively packages/db + the generated prisma client) to
# walk the `AppRouter` type. The runtime never executes any of this — these
# files exist purely to satisfy type resolution during `next dev` /
# `next build`.
COPY services/sector-service ./services/sector-service
COPY packages/db ./packages/db
COPY packages/ui ./packages/ui
RUN pnpm --filter @platform/db generate

# ---------- dev: hot-reload target (local mode) ----------
FROM deps AS dev
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Source is bind-mounted at runtime; this COPY is just so the image is usable
# without a mount (e.g. `docker run` for one-offs).
COPY apps/web ./apps/web
# apps/web/tsconfig.json extends ../../tsconfig.base.json — must be present
# at /repo for `next dev` to typecheck.
COPY tsconfig.base.json ./tsconfig.base.json
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---------- builder: produce the standalone build ----------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web ./apps/web
COPY tsconfig.base.json ./tsconfig.base.json
WORKDIR /repo/apps/web
RUN pnpm build

# ---------- prod: minimal runtime ----------
FROM node:${NODE_VERSION} AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app

# Next.js without `output: 'standalone'` ships full .next/ + node_modules.
# We copy what `next start` actually needs.
COPY --from=builder /repo/apps/web/.next ./.next
COPY --from=builder /repo/apps/web/public ./public
COPY --from=builder /repo/apps/web/package.json ./package.json
COPY --from=builder /repo/apps/web/next.config.ts ./next.config.ts
COPY --from=builder /repo/node_modules ./node_modules

# Drop to a non-root user — node:alpine ships one.
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
