# Build context is the repo root (not this directory) so pnpm can see the
# workspace: apps/video-worker depends on packages/core via workspace:*.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
# Doppler CLI injects secrets at start via doppler-entrypoint (wired up in compose). Copied from the official
# image because it is a static Go binary, so no apt repo or keyring setup is needed.
COPY --from=dopplerhq/cli:3.76.5 /bin/doppler /usr/local/bin/doppler
COPY --chmod=755 docker/doppler-entrypoint.sh /usr/local/bin/doppler-entrypoint
# In base so dev and runtime both get them; transcoding shells out to the ffmpeg binary, and doppler
# needs the CA bundle (absent from the slim base) to reach its API over HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps first, keyed only on manifests, so this layer caches
# independently of application source changes.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/video-worker/package.json apps/video-worker/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

# No HTTP server, so no healthcheck.
FROM deps AS dev
COPY . .
CMD ["pnpm", "--filter", "video-worker", "run", "dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter video-worker... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/video-worker/dist/index.js"]
