# bonitashare

pnpm monorepo:

- `apps/api`: Fastify API (uploads, sessions, downloads)
- `apps/worker`: BullMQ file-processing worker (thumbnails, reconcile sweep)
- `apps/web`: Astro frontend
- `packages/core`: shared db, storage, queue and shutdown code, plus the drizzle migrations
- `packages/shared-types`: types shared by api and web

Everything runs in Docker for development. Run the commands below from the repo root.

Each app has its own `.env`. Copy it from the `.env.example` next to it. `apps/worker/.env` holds only
the db, redis and s3 settings. Its shared values (db, redis, s3 credentials and buckets) must match
`apps/api/.env`.

## Daily commands

### Start / stop

```sh
docker compose up -d                 # start everything (2 api replicas, worker, web, postgres, redis, storage)
docker compose down                  # stop everything (data volumes are kept)
docker compose ps                    # status and health
docker compose logs -f api worker    # follow logs (add web, postgres, ...)
docker compose restart worker        # restart one service
```

### After changing dependencies or a package.json

```sh
pnpm install
docker compose up -d --build --renew-anon-volumes api worker web
```

Each container's `node_modules` lives in an anonymous volume. Compose reuses that volume across
rebuilds unless you pass `--renew-anon-volumes` (`-V`). Without it, newly added packages, including
workspace packages like `@bonitashare/core`, show up as `ERR_MODULE_NOT_FOUND` inside the container.

### Database (drizzle, run from `packages/core`)

```sh
pnpm db:generate    # create a migration from changes to packages/core/src/db/schema.ts
pnpm db:migrate     # apply pending migrations
pnpm db:studio      # open drizzle studio from the host (reads apps/api/.env)
```

`db:generate` and `db:migrate` run inside the api container, so the stack must be up.

### Checks and builds

```sh
pnpm typecheck      # builds shared-types and core, then typechecks every package
pnpm build          # production build of all packages
```

## Notes

- In dev, api and worker run `tsx watch --conditions=development`, which loads `@bonitashare/core`
  straight from `src/`. Edits to core hot-reload without a rebuild. Production and `tsc` use core's
  `dist/`, so run `pnpm typecheck` (or `pnpm --filter @bonitashare/core dev` to rebuild on save) to
  get core changes into editor types.
- `docker compose -f docker-compose.prod.yml build` builds the production images locally.

## Deploying

Every push to `main` runs `.github/workflows/deploy.yml`: typecheck, build the api/worker/web images
and push them to GHCR tagged with the commit, then SSH to the VPS, where `deploy/deploy.sh` checks out
that commit, pulls its images and restarts what changed (migrations run first). To roll back, run
`~/bonitashare/deploy/deploy.sh <older full commit sha>` on the VPS; migrations are not undone.

One-time setup:

1. Make a key just for deploys: `ssh-keygen -t ed25519 -N '' -f deploy_key -C github-deploy`.
2. On the VPS, add `deploy_key.pub` to `~/.ssh/authorized_keys` with a forced command, so the key can
   only deploy:
   `command="/home/admin/bonitashare/deploy/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-deploy`
3. In the repo's Settings → Secrets and variables → Actions, add `DEPLOY_SSH_KEY` (contents of
   `deploy_key`), `DEPLOY_HOST` (`admin@<VPS IP>`) and `DEPLOY_KNOWN_HOSTS` (the VPS's line from your
   `~/.ssh/known_hosts`, or `ssh-keyscan -t ed25519 <VPS IP>` checked against it).
4. Let the VPS pull the images: either make the `bonitashare-api`, `-worker` and `-web` packages public
   (GitHub → Packages → package settings; they hold no secrets), or run `docker login ghcr.io` on the
   VPS with a token that has only `read:packages`.
5. The VPS fetches the commit with `git fetch`, so its checkout needs a remote it can read without
   your keys. The repo is public, so HTTPS works:
   `git remote set-url origin https://github.com/Varchronos/bonitashare.git`.
