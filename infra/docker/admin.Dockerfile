# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for apps/admin (Next.js 15, port 3100).
#   target=dev   → bind-mount source, `next dev` with Fast Refresh
#   target=prod  → standalone production build, `next start`
#
# Build context MUST be the repository root — admin consumes the same
# workspace graph as apps/web (sector-service AppRouter type, @platform/db,
# @platform/ui), so pnpm needs the full pnpm-workspace.yaml visible.

ARG NODE_VERSION=20.18-alpine

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY services/sector-service/package.json ./services/sector-service/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --filter @platform/admin...; \
    else \
      pnpm install --filter @platform/admin...; \
    fi
# Workspace member sources for TS type resolution + Prisma client.
COPY services/sector-service ./services/sector-service
COPY packages/db ./packages/db
COPY packages/ui ./packages/ui
RUN pnpm --filter @platform/db generate

# ---------- dev ----------
FROM deps AS dev
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/admin ./apps/admin
COPY tsconfig.base.json ./tsconfig.base.json
WORKDIR /repo/apps/admin
EXPOSE 3100
CMD ["pnpm", "dev"]

# ---------- builder ----------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/admin ./apps/admin
COPY tsconfig.base.json ./tsconfig.base.json
WORKDIR /repo/apps/admin
RUN pnpm build

# ---------- prod ----------
FROM node:${NODE_VERSION} AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
WORKDIR /app

COPY --from=builder /repo/apps/admin/.next ./.next
COPY --from=builder /repo/apps/admin/package.json ./package.json
COPY --from=builder /repo/apps/admin/next.config.ts ./next.config.ts
COPY --from=builder /repo/node_modules ./node_modules

USER node
EXPOSE 3100
CMD ["node_modules/.bin/next", "start", "--port", "3100"]
