# Build context is the repo root (not this directory) so pnpm can see the
# workspace: apps/worker depends on packages/core via workspace:*.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
WORKDIR /app

# Install deps first, keyed only on manifests, so this layer caches
# independently of application source changes.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

# No HTTP server, so no healthcheck.
FROM deps AS dev
COPY . .
CMD ["pnpm", "--filter", "worker", "run", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter worker... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/worker/dist/index.js"]
