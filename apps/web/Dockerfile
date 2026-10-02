# Build context is the repo root (not this directory) — it's a pnpm workspace.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 4321
HEALTHCHECK --interval=5s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4321/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["pnpm", "--filter", "web", "run", "dev", "--host", "--force"]

FROM deps AS build
COPY . .
RUN pnpm --filter web... run build

# SSR needs a live Node process (server render on every request), not a
# static file server, so runtime is based on `base` with node_modules and
# the built dist/ carried over, rather than nginx serving prebuilt HTML.
FROM base AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 4321
HEALTHCHECK --interval=5s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4321/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
